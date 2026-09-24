// ExitGuard como MOTOR MODULAR: el servidor se construye a si mismo desde los
// nodos de nodes/. No hay lógica de endpoint aquí — cada nodo es autoejecutable
// y el registro deriva de él su precio (x402), su ruta, su entrada de
// descubrimiento y su autotest. Agregar un archivo en nodes/ genera su fase
// siguiente sin tocar este archivo. Clientes: AGENTES de IA que pagan USDC.
import express from "express";
import { paymentMiddleware } from "x402-express";
import { readFileSync } from "fs";
import { loadNodes, paymentConfig, mount, discovery, runSelfTests } from "./registry.js";

const app = express();

// >>> tu wallet que RECIBE los USDC (Base). <<<
const PAY_TO = process.env.PAY_TO || "0xb7584544F07c5f172718E029Afd3F1C9a50A513C";

// Facilitators MAINNET PÚBLICOS — sin cuenta, sin claves, sin fondear gas.
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
  try {
    const { facilitator } = await import("@coinbase/x402");  // opcional: Bazaar de Coinbase
    FACILITATOR = facilitator;
    console.log("facilitator: Coinbase CDP | red: base (USDC REAL, Bazaar)");
  } catch { FACILITATOR = await pickFacilitator(); }         // sin el paquete, usa públicos
} else {
  FACILITATOR = await pickFacilitator();
}

// --- AUTO-DESCUBRIMIENTO DE NODOS: la infraestructura se genera desde aquí ---
const { nodes, errors: nodeErrors } = await loadNodes();
for (const e of nodeErrors) console.log(`nodo roto ignorado: ${e.file} (${e.error})`);
console.log(`nodos cargados: ${nodes.map(n => n.id).join(", ")}`);

// Monetizacion x402: el precio de cada ruta sale del nodo. El middleware
// responde HTTP 402 si no viene pago; el agente paga en USDC y reintenta.
app.use(paymentMiddleware(
  PAY_TO,
  {
    ...paymentConfig(nodes, NET),
    // legado: /scan lee un dataset local (no es nodo; falla en hosts sin el archivo).
    "/scan": { price: "$0.05", network: NET,
      config: { description: "Top lanzamientos recientes rankeados por supervivencia (data-moat local)" } },
  },
  FACILITATOR
));

// --- métricas del negocio ---
const STATS = { requests: 0, paid: 0, started: Date.now(), last_paid_ts: null };
app.use((req, _res, next) => { if (req.path !== "/stats") STATS.requests++; next(); });

// MONTA cada nodo como ruta pagada, contando en STATS. Sin código por endpoint.
mount(app, nodes, STATS);

// saldo REAL de USDC de tu wallet en Base mainnet (dato público de la cadena)
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

// --- DESCUBRIMIENTO: agentes y directorios (Bazaar, x402-list) leen esto ---
app.get("/.well-known/x402.json", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.json({
    x402Version: 1, name: "ExitGuard",
    description: "Seguridad on-chain para agentes de trading: exit-check, survival-score, triaje de hooks V4 y detector de drainers.",
    network: NET, payTo: PAY_TO, asset: "USDC",
    endpoints: discovery(nodes),                 // generado desde los nodos
    discoverable: true, url: `https://${req.get("host")}`,
  });
});
// A2A AgentCard: lo que un agente A2A lee para descubrir skills y cómo pagar.
app.get("/.well-known/agent-card.json", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  const base = `https://${req.get("host")}`;
  res.json({
    protocolVersion: "0.3.0",
    name: "ExitGuard",
    description: "Agente de seguridad on-chain para agentes de trading: criba pre-compra Solana (GO/NO-GO), liquidez de salida ejecutable, rug-check, y auditoría de calldata/hooks EVM.",
    url: base,
    preferredTransport: "JSONRPC",
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text"], defaultOutputModes: ["application/json"],
    provider: { organization: "ExitGuard", url: base },
    skills: discovery(nodes).map(e => ({
      id: e.path.slice(1), name: e.path.slice(1),
      description: e.description, tags: ["defi", "safety", "solana", "evm", "x402"],
      inputModes: ["text"], outputModes: ["application/json"],
    })),
    // pago por x402 (extensión): cada skill cobra en USDC sobre Base
    x402: { network: NET, asset: "USDC", payTo: PAY_TO,
            prices: Object.fromEntries(discovery(nodes).map(e => [e.path.slice(1), e.price])) },
  });
});

// ERC-8004: archivo de registro del agente (al que apunta el Identity Registry).
// Deja el agente listo para registro trustless; el único paso restante es la tx
// on-chain que graba el agentId (requiere gas + firma del dueño de la wallet).
app.get("/.well-known/erc8004.json", (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  const base = `https://${req.get("host")}`;
  res.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "ExitGuard",
    description: "Agente trustless de seguridad DeFi: criba pre-compra, salida ejecutable, rug-check y auditoría de calldata. Pago por x402 en USDC/Base.",
    image: `${base}/icon.png`,
    active: true,
    x402Support: true,
    supportedTrust: ["reputation", "crypto-economic"],
    services: [
      { name: "web", endpoint: base },
      { name: "A2A", endpoint: `${base}/.well-known/agent-card.json`, version: "0.3.0" },
      { name: "MCP", endpoint: `${base}/mcp`,
        oasf: { skills: discovery(nodes).map(e => e.path.slice(1)), domains: ["defi-safety"] } },
      { name: "x402", endpoint: `${base}/.well-known/x402.json` },
    ],
    // se rellena tras la tx on-chain en el Identity Registry (agentId, dirección del registro)
    registrations: [{ agentId: null, agentRegistry: null, note: "pendiente de tx on-chain (gas + firma del dueño)" }],
  });
});
// índice legible por modelos de IA — también generado desde los nodos
app.get("/llms.txt", (req, res) => {
  res.type("text/plain").set("Access-Control-Allow-Origin", "*");
  const base = `https://${req.get("host")}`;
  const tools = discovery(nodes)
    .map(e => `- GET ${base}${e.path}?${e.params.map(p => p + "=").join("&")}  (${e.price}) — ${e.description}`)
    .join("\n");
  res.send(
`# ExitGuard — seguridad on-chain para agentes
Servicio x402 (pago por request en USDC, Base mainnet). Wallet: ${PAY_TO}

## Herramientas
${tools}

Pago: x402. Descubrimiento: ${base}/.well-known/x402.json
Defensivo: mide riesgo de salida, supervivencia y seguridad de calldata; no promete pumps.`);
});

// SALUD EN VIVO: el servicio corre sus propios autotests bajo demanda. El motor
// se prueba a sí mismo — "monitorea y prueba en tiempo real".
app.get("/health", (_req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  const { ok, results } = runSelfTests(nodes);
  res.status(ok ? 200 : 503).json({
    ok, nodes: nodes.length, broken_nodes: nodeErrors.length,
    tests: results.map(r => ({ id: r.id, ok: r.ok, checks: r.checks.length })),
    ts: Date.now(),
  });
});

// legado: escaneo en vivo desde dataset local (no es nodo).
function survScore(dev, ser, vs){ let s=50; s+=dev>2?25:dev>0.5?12:dev<0.05?-15:0; s+=ser>=2?-20:8; s+=vs>40?15:vs<30.5?-10:0; return Math.max(0,Math.min(100,s)); }
app.get("/scan", (_req, res) => {
  STATS.paid++; STATS.last_paid_ts = Date.now();
  try {
    const lines = readFileSync("C:/Users/Admin/edge-lab/data/acc_launches.jsonl", "utf-8").trim().split("\n");
    const now = Date.now()/1000; const seen = new Map();
    for (const ln of lines) {
      let x; try { x = JSON.parse(ln); } catch { continue; }
      if (!x.mint || now - x.ts > 10800 || now - x.ts < 300) continue;
      x.sc = survScore(x.dev_buy||0, x.serial||0, x.vsol||30);
      const prev = seen.get(x.mint);
      if (!prev || x.sc > prev.sc) seen.set(x.mint, x);
    }
    const top = [...seen.values()].sort((a,b)=>b.sc-a.sc).slice(0,15)
      .map(x=>({mint:x.mint, symbol:x.sym, score:x.sc,
        band: x.sc>=70?"ALTA":x.sc>=45?"MEDIA":"BAJA",
        dev_buy_sol:x.dev_buy, vsol:x.vsol, age_min:Math.round((now-x.ts)/60)}));
    res.json({ scanned: seen.size, top, note: "score = prob. de supervivencia; no es señal de pump", ts: Date.now() });
  } catch (e) { res.status(500).json({ error: "scan no disponible", detail: String(e.message) }); }
});

// métricas para el dashboard (gratis, CORS abierto). Incluye saldo REAL de la cadena.
app.get("/stats", async (_req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  const bal = await usdcBalance(PAY_TO);
  res.json({
    wallet: PAY_TO, network: NET,
    facilitator: FACILITATOR.url || "coinbase-cdp",
    usdc_balance: bal,
    nodes: nodes.length,
    requests: STATS.requests, paid: STATS.paid,
    revenue_est_usd: +(STATS.paid * 0.015).toFixed(3),
    last_paid_ts: STATS.last_paid_ts,
    uptime_min: Math.round((Date.now() - STATS.started) / 60000),
    live: true,
  });
});

// SDK servido desde nuestro dominio (sin npm)
app.get("/sdk.js", (_req, res) => {
  res.set("Access-Control-Allow-Origin", "*").type("application/javascript");
  try { res.send(readFileSync(new URL("./sdk.js", import.meta.url), "utf-8")); }
  catch { res.status(404).send("// sdk no disponible"); }
});

// endpoint gratis para que los agentes descubran el servicio y sus precios
app.get("/", (_req, res) => res.json({
  service: "exitguard",
  desc: "Seguridad on-chain para agentes de trading (motor modular de nodos)",
  endpoints: Object.fromEntries(discovery(nodes).map(e =>
    [`GET ${e.path}?${e.params.map(p => "<" + p + ">").join("&")}`, `${e.price} — ${e.description}`])),
  health: "GET /health", discovery: "GET /.well-known/x402.json",
  payment: "x402, USDC, network: base",
}));

const PORT = process.env.PORT || 8402;
app.listen(PORT, () => console.log(`ExitGuard (motor modular) escuchando en :${PORT}, cobra a ${PAY_TO}`));
