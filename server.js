// Exit-Check as an x402 service — clientes: AGENTES de IA, no humanos.
// Cada agente de trading que quiera saber si un token es vendible llama a este
// endpoint y PAGA USDC automaticamente por request. Sin cuentas, sin API keys,
// sin funnel de marketing. Rompe el muro de audiencia: el cliente es una maquina.
import express from "express";
import { paymentMiddleware } from "x402-express";

const app = express();

// >>> tu wallet que RECIBE los USDC (Base). <<<
const PAY_TO = process.env.PAY_TO || "0xb7584544F07c5f172718E029Afd3F1C9a50A513C";

// Facilitators MAINNET PÚBLICOS — sin cuenta, sin claves, sin fondear gas.
// El facilitator paga el gas de liquidación; el USDC REAL llega a tu wallet.
// Con respaldo: al arrancar elige el primero VIVO que soporte Base mainnet.
const NET = "base";
const FACILITATOR_POOL = [
  "https://facilitator.payai.network",
  "https://facilitator.heurist.xyz",
  "https://facilitator.daydreams.systems",
  "https://facilitator.dexter.cash",
];
async function pickFacilitator() {
  for (const url of FACILITATOR_POOL) {
    try {
      const r = await fetch(url + "/supported", { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const d = await r.json();
      const nets = new Set((d.kinds || []).map(k => k.network));
      if (nets.has("base") || nets.has("eip155:8453")) {
        console.log(`facilitator elegido: ${url} (vivo, mainnet)`);
        return { url };
      }
    } catch { /* probar el siguiente */ }
  }
  console.log("aviso: ningún facilitator respondió; uso PayAI por defecto");
  return { url: FACILITATOR_POOL[0] };
}
let FACILITATOR;
if (process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET) {
  const { facilitator } = await import("@coinbase/x402");   // opcional: Bazaar de Coinbase
  FACILITATOR = facilitator;
  console.log("facilitator: Coinbase CDP | red: base (USDC REAL, Bazaar)");
} else {
  FACILITATOR = await pickFacilitator();
}

// Monetizacion x402: este endpoint cuesta $0.01 USDC por llamada.
// El middleware responde HTTP 402 si no viene pago, el agente paga y reintenta.
app.use(paymentMiddleware(
  PAY_TO,
  {
    "/exit-check": {
      price: "$0.01",
      network: NET,
      config: { description: "Chequeo de liquidez de salida de un token de Solana (round-trip ejecutable via Jupiter)" }
    },
    // la data-moat monetizada: score de supervivencia calibrado sobre 12k+ nacimientos,
    // validado walk-forward (el cuartil top gradua 6x mas que el bottom). Nadie mas lo tiene.
    "/survival-score": {
      price: "$0.02",
      network: NET,
      config: { description: "Probabilidad de supervivencia de un token al nacer, calibrada sobre dataset propio forward-measured" }
    }
  },
  FACILITATOR   // Coinbase mainnet si hay claves CDP; testnet por defecto
));

// Score 0-100 calibrado sobre el dataset propio (ver edge-lab/src/score.py).
// Defensivo: alto = mas probable que sobreviva; bajo = probable rug/muerte.
function survivalScore(devBuy, serial, vsol){
  let s = 50;
  s += devBuy>2 ? 25 : devBuy>0.5 ? 12 : devBuy<0.05 ? -15 : 0;
  s += serial>=2 ? -20 : 8;
  s += vsol>40 ? 15 : vsol<30.5 ? -10 : 0;
  return Math.max(0, Math.min(100, s));
}

const SOL = "So11111111111111111111111111111111111111112";
const Q = "https://lite-api.jup.ag/swap/v1/quote";

// --- métricas del negocio, para el dashboard ---
const STATS = { requests: 0, paid: 0, started: Date.now(), last_paid_ts: null };
// cuenta TODO request que llega (antes del paywall)
app.use((req, _res, next) => { if (req.path !== "/stats") STATS.requests++; next(); });

// lee el saldo REAL de USDC de tu wallet en Base mainnet (dato público de la cadena)
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // 6 decimales
async function usdcBalance(addr) {
  try {
    const data = "0x70a08231" + addr.slice(2).toLowerCase().padStart(64, "0");
    const r = await fetch("https://mainnet.base.org", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call",
        params: [{ to: USDC_BASE, data }, "latest"] })
    });
    const j = await r.json();
    return j.result ? Number(BigInt(j.result)) / 1e6 : null;
  } catch { return null; }
}

async function quote(inMint, outMint, amount){
  const r = await fetch(`${Q}?inputMint=${inMint}&outputMint=${outMint}&amount=${amount}&slippageBps=100`);
  if (r.status === 400) return { noRoute: true };
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// La logica probada del exit_scanner, ahora como servicio pago por request.
app.get("/exit-check", async (req, res) => {
  const mint = String(req.query.mint || "");
  const sol = Math.max(0.05, Math.min(50, Number(req.query.sol) || 1));
  if (mint.length < 32) return res.status(400).json({ error: "mint invalido" });
  try {
    const lamports = Math.round(sol * 1e9);
    const buy = await quote(SOL, mint, lamports);
    if (buy.noRoute) return res.json({ mint, sellable: false, verdict: "SIN_MERCADO" });
    const sell = await quote(mint, SOL, buy.outAmount);
    if (sell.noRoute) return res.json({ mint, sellable: false, verdict: "HONEYPOT" });
    const rt = (Number(sell.outAmount) - lamports) / lamports;
    const buyImpact = Number(buy.priceImpactPct || 0);
    const verdict = rt <= -0.5 ? "TRAMPA" : rt <= -0.15 ? "PELIGRO" : rt <= -0.05 ? "ACEPTABLE" : "LIQUIDO";
    STATS.paid++; STATS.last_paid_ts = Date.now();
    res.json({
      mint, sellable: true, size_sol: sol,
      roundtrip_pct: +(rt * 100).toFixed(2),
      buy_impact_pct: +(buyImpact * 100).toFixed(3),
      safe_slippage_pct: +Math.max(1, buyImpact * 150 + 0.5).toFixed(1),
      verdict, source: "jupiter", ts: Date.now()
    });
  } catch (e) {
    res.status(502).json({ error: "no se pudo cotizar", detail: String(e.message) });
  }
});

// score de supervivencia — la data-moat como endpoint pago
app.get("/survival-score", (req, res) => {
  const devBuy = Number(req.query.dev_buy) || 0;
  const serial = Number(req.query.serial) || 0;
  const vsol = Number(req.query.vsol) || 0;
  const score = survivalScore(devBuy, serial, vsol);
  STATS.paid++; STATS.last_paid_ts = Date.now();
  res.json({
    score, band: score>=70 ? "ALTA" : score>=45 ? "MEDIA" : "BAJA",
    meaning: "prob. de sobrevivir/graduar; calibrado forward, top-cuartil gradua 6x el bottom",
    inputs: { dev_buy: devBuy, serial, vsol }, ts: Date.now()
  });
});

// --- DESCUBRIMIENTO: los agentes y directorios (x402-list, etc.) leen esto para indexarte ---
// sitemap de pagos, machine-readable. Aparecer acá = ser auto-descubrible sin credenciales.
app.get("/.well-known/x402.json", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  const base = `https://${req.get("host")}`;
  res.json({
    x402Version: 1,
    name: "ExitGuard",
    description: "Capa de seguridad de tokens Solana para agentes de trading: exit-check y survival-score.",
    network: NET, payTo: PAY_TO, asset: "USDC",
    endpoints: [
      { path: "/exit-check", method: "GET", price: "$0.01",
        params: ["mint", "sol"], description: "¿Podés vender? Round-trip real vía Jupiter." },
      { path: "/survival-score", method: "GET", price: "$0.02",
        params: ["dev_buy", "serial", "vsol"], description: "Prob. de supervivencia; data-moat forward-measured." }
    ],
    discoverable: true, url: base
  });
});
// índice para modelos de IA
app.get("/llms.txt", (req, res) => {
  res.type("text/plain").set("Access-Control-Allow-Origin", "*");
  const base = `https://${req.get("host")}`;
  res.send(
`# ExitGuard — seguridad de tokens Solana para agentes
Servicio x402 (pago por request en USDC, Base mainnet). Wallet: ${PAY_TO}

## Herramientas
- GET ${base}/exit-check?mint=<mint>&sol=<size>  ($0.01) — ¿podés vender el token? round-trip ejecutable vía Jupiter; detecta honeypots.
- GET ${base}/survival-score?dev_buy=<sol>&serial=<n>&vsol=<n>  ($0.02) — probabilidad de que un token pump.fun sobreviva, calibrada sobre 12k+ nacimientos medidos hacia adelante.

Pago: x402. Descubrimiento: ${base}/.well-known/x402.json
Defensivo: mide riesgo de salida y supervivencia; no promete pumps.`);
});

// métricas para el dashboard (gratis, CORS abierto). Incluye saldo REAL de la cadena.
app.get("/stats", async (_req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  const bal = await usdcBalance(PAY_TO);
  res.json({
    wallet: PAY_TO, network: NET,
    facilitator: FACILITATOR.url || "coinbase-cdp",
    usdc_balance: bal,                       // saldo real en Base mainnet (dato de la cadena)
    requests: STATS.requests, paid: STATS.paid,
    revenue_est_usd: +(STATS.paid * 0.015).toFixed(3),  // estimado por llamada paga
    last_paid_ts: STATS.last_paid_ts,
    uptime_min: Math.round((Date.now() - STATS.started) / 60000),
    live: true
  });
});

// endpoint gratis para que los agentes descubran el servicio y sus precios
app.get("/", (_req, res) => res.json({
  service: "exitguard",
  desc: "Capa de seguridad de tokens Solana para agentes de trading",
  endpoints: {
    "GET /exit-check?mint=<mint>&sol=<size>": "$0.01 — ¿podés vender? (round-trip real)",
    "GET /survival-score?dev_buy=&serial=&vsol=": "$0.02 — prob. de supervivencia (data-moat)"
  },
  payment: "x402, USDC, network: base"
}));

const PORT = process.env.PORT || 8402;
app.listen(PORT, () => console.log(`exit-check x402 escuchando en :${PORT}, cobra a ${PAY_TO}`));
