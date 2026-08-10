const $ = id => document.getElementById(id);
const fmt = n => n == null || !Number.isFinite(n) ? "—" : Number(n).toLocaleString("zh-TW", { maximumFractionDigits: 2 });

const STOCK_NAMES = {
  "0050": "元大台灣50",
  "2002": "中鋼",
  "2303": "聯電",
  "2317": "鴻海",
  "2330": "台積電",
  "2409": "友達",
  "2454": "聯發科",
  "2603": "長榮",
  "3706": "神達",
  "8112": "至上",
};

const DEFAULT_FAVORITES = [
  { code: "0050", name: "元大台灣50" },
  { code: "2330", name: "台積電" },
  { code: "2317", name: "鴻海" },
  { code: "2409", name: "友達" },
  { code: "2454", name: "聯發科" },
  { code: "2303", name: "聯電" },
  { code: "8112", name: "至上" },
  { code: "3706", name: "神達" },
];

const RANKING = [
  { code: "2330", name: "台積電", tag: "熱門" },
  { code: "0050", name: "元大台灣50", tag: "ETF" },
  { code: "2409", name: "友達", tag: "面板" },
  { code: "2317", name: "鴻海", tag: "權值" },
  { code: "2454", name: "聯發科", tag: "IC" },
  { code: "2303", name: "聯電", tag: "半導體" },
  { code: "8112", name: "至上", tag: "通路" },
  { code: "3706", name: "神達", tag: "電腦" },
  { code: "2603", name: "長榮", tag: "航運" },
  { code: "2002", name: "中鋼", tag: "傳產" },
];

function baseCode(symbol) {
  return String(symbol || "").toUpperCase().split(".")[0];
}

function stockName(symbol) {
  return STOCK_NAMES[baseCode(symbol)] || "未建檔名稱";
}

function getFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem("stockFavorites") || "null");
    if (Array.isArray(saved) && saved.length) {
      const merged = [...saved];
      for (const item of DEFAULT_FAVORITES) {
        if (!merged.some(x => x.code === item.code)) merged.push(item);
      }
      return merged;
    }
    return DEFAULT_FAVORITES;
  } catch {
    return DEFAULT_FAVORITES;
  }
}

function saveFavorites(items) {
  localStorage.setItem("stockFavorites", JSON.stringify(items));
}

function selectStock(code) {
  $("symbol").value = code;
  $("market").value = "auto";
  analyze();
}

function renderFavorites() {
  const box = $("favoriteList");
  box.innerHTML = "";
  for (const item of getFavorites()) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    const name = item.name || stockName(item.code);
    btn.title = name;
    btn.textContent = `${item.code} ${name}`;
    btn.addEventListener("click", () => selectStock(item.code));
    box.appendChild(btn);
  }
}

function renderRanking() {
  const box = $("rankList");
  box.innerHTML = "";
  RANKING.forEach((item, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rank-item";
    btn.innerHTML = `
      <span class="rank-no">${index + 1}</span>
      <span><span class="rank-code">${item.code}</span><span class="rank-name">${item.name}</span></span>
      <span class="rank-tag">${item.tag}</span>
    `;
    btn.addEventListener("click", () => selectStock(item.code));
    box.appendChild(btn);
  });
}

function addCurrentFavorite() {
  const code = $("symbol").value.trim().toUpperCase();
  if (!code) return;
  const items = getFavorites();
  if (!items.some(x => x.code === code)) {
    items.unshift({ code, name: stockName(code) });
    saveFavorites(items.slice(0, 12));
    renderFavorites();
  }
}

async function showNetworkInfo(){
  try{
    const data = await (await fetch("/api/network")).json();
    const url = data.lanUrls?.[0];
    if(!url) return;
    $("mobileHelp").className = "mobile-help show";
    $("mobileHelp").innerHTML = `Android 手機同 Wi‑Fi 可開：<code>${url}</code><button id="copyUrl">複製網址</button><br>手機 Chrome 開啟後，可用選單「加入主畫面」。`;
    $("copyUrl").onclick = () => navigator.clipboard?.writeText(url);
  }catch{}
}

function sma(a){return a.reduce((s,x)=>s+x,0)/a.length}
function indicators(c, p, dev, rsiP, mf, ms, sigP){
  const close = c.map(x=>x.close);
  const rows = c.map(x=>({...x}));
  for(let i=p-1;i<rows.length;i++){
    const w=close.slice(i-p+1,i+1), m=sma(w), sd=Math.sqrt(sma(w.map(x=>(x-m)**2)));
    rows[i].bbMid=m; rows[i].bbUpper=m+dev*sd; rows[i].bbLower=m-dev*sd;
  }
  let gain=0, loss=0;
  for(let i=1;i<=rsiP;i++){const d=close[i]-close[i-1]; if(d>=0)gain+=d; else loss-=d}
  gain/=rsiP; loss/=rsiP; rows[rsiP].rsi=loss===0?100:100-100/(1+gain/loss);
  for(let i=rsiP+1;i<rows.length;i++){const d=close[i]-close[i-1]; gain=(gain*(rsiP-1)+Math.max(d,0))/rsiP; loss=(loss*(rsiP-1)+Math.max(-d,0))/rsiP; rows[i].rsi=loss===0?100:100-100/(1+gain/loss)}
  const ema=(period)=>{const k=2/(period+1), out=[]; let e; close.forEach((v,i)=>{e=i===0?v:v*k+e*(1-k); out.push(e)}); return out}
  const fast=ema(mf), slow=ema(ms), macd=close.map((_,i)=>fast[i]-slow[i]);
  const k=2/(sigP+1); let s=macd[0];
  rows.forEach((r,i)=>{s=i===0?macd[i]:macd[i]*k+s*(1-k); r.macd=macd[i]; r.signal=s; r.hist=r.macd-r.signal});
  for(let i=19;i<rows.length;i++) rows[i].volAvg=sma(rows.slice(i-19,i+1).map(x=>x.volume));
  return rows;
}

function scale(vals, a, b){
  const min=Math.min(...vals), max=Math.max(...vals), pad=(max-min)*.08||1;
  return v=>b-(v-min+pad)/(max-min+pad*2)*(b-a);
}

function drawLines(svg, rows, specs, fixedMinMax){
  svg.innerHTML="";
  const w=svg.clientWidth||1000,h=300,p=30, xs=i=>p+i*(w-p*2)/(rows.length-1);
  const vals=[];
  specs.forEach(s=>rows.forEach(r=>Number.isFinite(r[s.key])&&vals.push(r[s.key])));
  const y = fixedMinMax ? (v=>h-p-(v-fixedMinMax[0])/(fixedMinMax[1]-fixedMinMax[0])*(h-p*2)) : scale(vals,p,h-p);
  svg.insertAdjacentHTML("beforeend",`<line class="axis" x1="${p}" y1="${h-p}" x2="${w-p}" y2="${h-p}"/><line class="axis" x1="${p}" y1="${p}" x2="${p}" y2="${h-p}"/>`);
  specs.forEach(s=>{
    const pts=rows.map((r,i)=>Number.isFinite(r[s.key])?`${xs(i)},${y(r[s.key])}`:null).filter(Boolean).join(" ");
    svg.insertAdjacentHTML("beforeend",`<polyline class="line ${s.cls}" points="${pts}"/>`);
  });
}

function drawVolume(svg, rows){
  svg.innerHTML="";
  const w=svg.clientWidth||1000,h=300,p=30, max=Math.max(...rows.map(r=>r.volume),1), bw=Math.max(2,(w-p*2)/rows.length*.75);
  rows.forEach((r,i)=>{
    const x=p+i*(w-p*2)/(rows.length-1)-bw/2, bh=r.volume/max*(h-p*2);
    svg.insertAdjacentHTML("beforeend",`<rect class="bar ${r.close<r.open?'down':''}" x="${x}" y="${h-p-bh}" width="${bw}" height="${bh}"/>`);
  });
  const avgRows = rows.filter(r=>r.volAvg);
  if (avgRows.length > 1) {
    const pts = avgRows.map((r,i)=>`${p+i*(w-p*2)/(avgRows.length-1)},${h-p-r.volAvg/max*(h-p*2)}`).join(" ");
    svg.insertAdjacentHTML("beforeend",`<polyline class="line middle" points="${pts}"/>`);
  }
}

function drawMacd(svg, rows){
  svg.innerHTML="";
  const w=svg.clientWidth||1000,h=300,p=30, vals=rows.flatMap(r=>[r.macd,r.signal,r.hist]).filter(Number.isFinite), y=scale(vals,p,h-p), xs=i=>p+i*(w-p*2)/(rows.length-1), bw=Math.max(2,(w-p*2)/rows.length*.75);
  rows.forEach((r,i)=>{
    if(Number.isFinite(r.hist)){
      const y0=y(0), y1=y(r.hist);
      svg.insertAdjacentHTML("beforeend",`<rect class="hist ${r.hist>=0?'pos':'neg'}" x="${xs(i)-bw/2}" y="${Math.min(y0,y1)}" width="${bw}" height="${Math.abs(y1-y0)}"/>`);
    }
  });
  [["macd","macd"],["signal","signal"]].forEach(([key,cls])=>svg.insertAdjacentHTML("beforeend",`<polyline class="line ${cls}" points="${rows.map((r,i)=>`${xs(i)},${y(r[key])}`).join(" ")}"/>`));
}

function card(k,v,s=""){return `<article class="card"><b>${k}</b><strong>${v}</strong><small>${s}</small></article>`}

async function analyze(){
  $("status").className="status";
  $("status").textContent="分析中...";
  try{
    const qs=new URLSearchParams({symbol:$("symbol").value,market:$("market").value,range:$("range").value});
    const r=await fetch(`/api/stock?${qs}`);
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"無法分析");
    let info={};
    try{info=await (await fetch(`/api/market-info?symbol=${encodeURIComponent(data.symbol)}`)).json()}catch{}
    const rows=indicators(data.candles,+$("bbPeriod").value,+$("bbDev").value,+$("rsiPeriod").value,+$("macdFast").value,+$("macdSlow").value,+$("macdSignal").value);
    const latest=rows.at(-1);
    const pos = latest.close>latest.bbUpper?"突破上緣":latest.close<latest.bbLower?"跌破下緣":"通道內";
    const rsiText = latest.rsi>=70?"偏熱":latest.rsi<=30?"偏冷":"中性";
    const macdText = latest.macd>latest.signal?"多方":"空方";
    const marginDiff = info.marginBalance!=null && info.marginPrevious!=null ? info.marginBalance-info.marginPrevious : null;
    $("cards").innerHTML=[
      card("代號",data.symbol,`${stockName(data.symbol)}｜最新日期 ${latest.date}`),
      card("收盤價",fmt(latest.close),pos),
      card("RSI",fmt(latest.rsi),rsiText),
      card("MACD",fmt(latest.hist),macdText),
      card("成交量",`${fmt(Math.round(latest.volume/1000))} 張`,"Yahoo 日線成交量"),
      card("融資餘額",info.marginBalance==null?"—":`${fmt(info.marginBalance)} 張`,marginDiff==null?info.source||"官方資料未提供":`${info.date||""} 較前日 ${marginDiff>=0?"+":""}${fmt(marginDiff)} 張`),
      card("本益比",fmt(info.peRatio),info.source||"官方資料未提供"),
      card("布林通道",`上 ${fmt(latest.bbUpper)}`,`中 ${fmt(latest.bbMid)}｜下 ${fmt(latest.bbLower)}`)
    ].join("");
    drawLines($("priceChart"),rows,[{key:"close",cls:"close"},{key:"bbUpper",cls:"upper"},{key:"bbMid",cls:"middle"},{key:"bbLower",cls:"lower"}]);
    drawVolume($("volumeChart"),rows);
    drawLines($("rsiChart"),rows,[{key:"rsi",cls:"rsi"}],[0,100]);
    drawMacd($("macdChart"),rows);
    $("status").textContent=`完成：${data.symbol}`;
  }catch(e){
    $("status").className="status err";
    $("status").textContent=`無法分析：${e.message}`;
  }
}

$("analyze").addEventListener("click",analyze);
$("addFavorite").addEventListener("click",addCurrentFavorite);
$("symbol").addEventListener("keydown", event => {
  if (event.key === "Enter") analyze();
});

if ("serviceWorker" in navigator) {
  const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (isLocal) {
    navigator.serviceWorker.getRegistrations?.().then(regs => regs.forEach(reg => reg.unregister())).catch(()=>{});
  } else if (location.protocol === "https:") {
    navigator.serviceWorker.register("/service-worker.js").catch(()=>{});
  }
}

renderFavorites();
renderRanking();
showNetworkInfo();
analyze();
