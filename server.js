const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

function getLanUrls() {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) {
        urls.push(`http://${net.address}:${PORT}/`);
      }
    }
  }
  return urls;
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function normalizeSymbol(raw, market) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return "";
  if (s.includes(".")) return s;
  if (market === "tw") return `${s}.TW`;
  if (market === "two") return `${s}.TWO`;
  if (market === "us") return s;
  return s;
}

function symbolCandidates(raw, market) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return [];
  if (s.includes(".") || market !== "auto") return [normalizeSymbol(s, market)];
  if (/^\d+$/.test(s)) return [`${s}.TW`, `${s}.TWO`];
  return [s];
}

async function fetchYahooChart(symbol, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=1d&events=history`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`Yahoo 回應錯誤 (${r.status})`);
  const data = await r.json();
  const result = data.chart && data.chart.result && data.chart.result[0];
  if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
    throw new Error("查無股價資料");
  }
  const q = result.indicators.quote[0];
  const candles = result.timestamp.map((t, i) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10),
    open: q.open?.[i],
    high: q.high?.[i],
    low: q.low?.[i],
    close: q.close?.[i],
    volume: q.volume?.[i] || 0,
  })).filter(x => Number.isFinite(x.close));
  if (candles.length < 30) throw new Error("資料筆數不足，無法分析");
  return { symbol, currency: result.meta?.currency || "", candles };
}

let infoCache = { at: 0, data: null };

async function getOfficialData() {
  if (infoCache.data && Date.now() - infoCache.at < 5 * 60 * 1000) return infoCache.data;
  const urls = {
    twPe: "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL",
    twMargin: "https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN",
    twoPe: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis",
    twoMargin: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance",
  };
  const entries = await Promise.all(Object.entries(urls).map(async ([k, u]) => {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(6000) });
      return [k, r.ok ? await r.json() : []];
    } catch {
      return [k, []];
    }
  }));
  infoCache = { at: Date.now(), data: Object.fromEntries(entries) };
  return infoCache.data;
}

function n(v) {
  if (v === undefined || v === null || v === "") return null;
  const x = Number(String(v).replaceAll(",", ""));
  return Number.isFinite(x) ? x : null;
}

function rocDate(v) {
  const s = String(v || "").replaceAll("/", "").trim();
  if (!/^\d{6,7}$/.test(s)) return "";
  const yLen = s.length - 4;
  const y = Number(s.slice(0, yLen)) + 1911;
  return `${y}-${s.slice(yLen, yLen + 2)}-${s.slice(yLen + 2)}`;
}

async function marketInfo(symbol) {
  const code = String(symbol).split(".")[0];
  const isTwo = String(symbol).endsWith(".TWO");
  const data = await getOfficialData();
  const peRows = isTwo ? data.twoPe : data.twPe;
  const marginRows = isTwo ? data.twoMargin : data.twMargin;
  const pe = (peRows || []).find(r => r.Code === code || r.SecuritiesCompanyCode === code || r["證券代號"] === code);
  const m = (marginRows || []).find(r => r.Code === code || r.SecuritiesCompanyCode === code || r["股票代號"] === code || r["證券代號"] === code);
  return {
    source: isTwo ? "TPEx 櫃買中心 OpenAPI" : "TWSE 證交所 OpenAPI",
    peRatio: n(pe?.PEratio ?? pe?.PriceEarningRatio ?? pe?.["本益比"]),
    marginBalance: n(m?.["融資今日餘額"] ?? m?.MarginPurchaseBalance ?? m?.MarginPurchaseBalanceAfterBuySell),
    marginPrevious: n(m?.["融資前日餘額"] ?? m?.MarginPurchaseBalancePreviousDay),
    marginBuy: n(m?.["融資買進"] ?? m?.MarginPurchaseBuy),
    marginSell: n(m?.["融資賣出"] ?? m?.MarginPurchaseSell),
    date: rocDate(pe?.Date || m?.Date || pe?.["日期"] || m?.["日期"]),
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/stock") {
      const raw = url.searchParams.get("symbol");
      const market = url.searchParams.get("market") || "auto";
      const range = url.searchParams.get("range") || "6mo";
      let lastError;
      for (const sym of symbolCandidates(raw, market)) {
        try {
          return sendJson(res, 200, await fetchYahooChart(sym, range));
        } catch (e) {
          lastError = e;
        }
      }
      return sendJson(res, 404, { error: lastError?.message || "查無資料" });
    }
    if (url.pathname === "/api/market-info") {
      return sendJson(res, 200, await marketInfo(url.searchParams.get("symbol")));
    }
    if (url.pathname === "/api/network") {
      return sendJson(res, 200, {
        localUrl: `http://127.0.0.1:${PORT}/`,
        lanUrls: getLanUrls(),
        port: PORT,
      });
    }
    if (url.pathname === "/healthz") {
      return sendJson(res, 200, {
        ok: true,
        service: "stock-indicator-analyzer",
      });
    }
    const file = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const full = path.join(PUBLIC_DIR, file);
    if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Stock analyzer: http://127.0.0.1:${PORT}/`);
  for (const url of getLanUrls()) console.log(`Mobile/LAN: ${url}`);
});
