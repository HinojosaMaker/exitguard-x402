#!/usr/bin/env node
// MCP de ExitGuard — CLIENTE DE PAGO. Cada tool llama al endpoint HOSPEDADO de
// pago; si el agente que instala este MCP configura su wallet (X402_PRIVATE_KEY),
// su maquina PAGA el x402 sola a la wallet de ExitGuard y recibe el resultado.
// Maquinas pagando a maquinas, automatico. Sin wallet -> devuelve el reto 402
// (precio + payTo) para que el agente sepa fondear. Descubre las tools del propio
// servicio vivo (/.well-known/x402.json), asi el catalogo nunca se desincroniza.
import readline from "node:readline";

const BASE = process.env.EXITGUARD_URL || "https://exitguard-oracle.onrender.com";
const PK = process.env.X402_PRIVATE_KEY || "";
const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");

// fetch con pago x402 si hay wallet; si no, fetch normal (devolvera 402).
async function makeFetch() {
  if (!PK) return { fetch, paid: false };
  try {
    const [{ wrapFetchWithPayment }, { createWalletClient, http }, { privateKeyToAccount }, { base }] =
      await Promise.all([
        import("x402-fetch"), import("viem"), import("viem/accounts"), import("viem/chains"),
      ]);
    const account = privateKeyToAccount(PK.startsWith("0x") ? PK : "0x" + PK);
    const client = createWalletClient({ account, chain: base, transport: http() });
    return { fetch: wrapFetchWithPayment(fetch, client), paid: true };
  } catch (e) {
    process.stderr.write(`[exitguard-mcp] wallet no inicializada (${e.message}); modo sin pago\n`);
    return { fetch, paid: false };
  }
}

async function discover() {
  try {
    const d = await (await fetch(`${BASE}/.well-known/x402.json`)).json();
    return (d.endpoints || []).map((e) => ({
      path: (e.path || e.route || "").replace(/^\//, ""),
      price: e.price || e.maxAmountRequired || "?",
      description: e.description || "",
      params: e.params || e.inputs || [],
    })).filter((e) => e.path);
  } catch { return []; }
}

function qs(args) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(args || {})) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? "?" + s : "";
}

async function main() {
  const eps = await discover();
  const { fetch: fx, paid } = await makeFetch();
  const tools = eps.map((e) => ({
    name: e.path.replace(/-/g, "_"),
    description: `${e.description} · x402 ${e.price} USDC to ExitGuard (Base). ${paid ? "Your wallet pays automatically." : "Set X402_PRIVATE_KEY to auto-pay."}`,
    inputSchema: { type: "object", properties: Object.fromEntries((e.params || []).map((p) => [p, { type: "string" }])) },
  }));
  const byName = Object.fromEntries(eps.map((e) => [e.path.replace(/-/g, "_"), e]));
  process.stderr.write(`[exitguard-mcp] ${tools.length} tools | pago ${paid ? "ACTIVADO" : "no configurado"} | ${BASE}\n`);

  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    const { id, method, params } = msg;
    if (method === "initialize") {
      send({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} },
        serverInfo: { name: "exitguard", version: "2.0.0" } } });
    } else if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools } });
    } else if (method === "tools/call") {
      const e = byName[params?.name];
      if (!e) { send({ jsonrpc: "2.0", id, error: { code: -32601, message: "tool desconocida" } }); continue; }
      try {
        const r = await fx(`${BASE}/${e.path}${qs(params.arguments)}`);
        if (r.status === 402) {
          const ch = await r.json().catch(() => ({}));
          const a = (ch.accepts || [])[0] || {};
          send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text:
            `PAGO REQUERIDO: ${e.price} USDC en Base a ${a.payTo || ""}. Configura X402_PRIVATE_KEY (wallet con USDC) para que tu agente pague solo.` }] } });
        } else {
          const body = await r.text();
          send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: body }] } });
        }
      } catch (err) {
        send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(err?.message || err) } });
      }
    } else if (method === "notifications/initialized") { /* no-op */ }
    else if (id !== undefined) { send({ jsonrpc: "2.0", id, error: { code: -32601, message: "método no soportado" } }); }
  }
}
main();
