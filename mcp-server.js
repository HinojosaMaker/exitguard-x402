// Servidor MCP de ExitGuard: expone los MISMOS nodos como herramientas que un
// agente de IA descubre y llama. MCP es el protocolo por el que los compradores
// reales (agentes) encuentran tools; x402 es cómo pagan. Aquí cada nodo es las
// dos cosas a la vez: endpoint HTTP de pago y tool MCP de descubrimiento.
//
// MCP = JSON-RPC 2.0 sobre stdio. Sin dependencias: initialize, tools/list,
// tools/call. Un agente lanza este proceso y habla por stdin/stdout.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import readline from "node:readline";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAY_TO = process.env.PAY_TO || "0xb7584544F07c5f172718E029Afd3F1C9a50A513C";

// auto-descubre los nodos, igual que el registry HTTP
async function loadNodes() {
  const dir = path.join(HERE, "nodes");
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    try {
      const m = await import(pathToFileURL(path.join(dir, f)).href);
      if (m.default?.id && typeof m.default.handle === "function") out.push(m.default);
    } catch { /* nodo roto: se ignora, no tumba el server */ }
  }
  return out;
}

function toTool(n) {
  return {
    name: n.id.replace(/-/g, "_"),
    description: `${n.description} · precio para uso comercial vía x402: ${n.price} USDC (Base), payTo ${PAY_TO}. En MCP la llamada es gratis para evaluación.`,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries((n.params || []).map((p) => [p, { type: "string" }])),
      required: (n.params || []).filter((p) => p === "mint" || p === "calldata" || p === "address"),
    },
  };
}

const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");

async function main() {
  const nodes = await loadNodes();
  const byName = Object.fromEntries(nodes.map((n) => [n.id.replace(/-/g, "_"), n]));
  const tools = nodes.map(toTool);
  process.stderr.write(`[exitguard-mcp] ${tools.length} tools listas: ${tools.map((t) => t.name).join(", ")}\n`);

  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const { id, method, params } = msg;

    if (method === "initialize") {
      send({ jsonrpc: "2.0", id, result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "exitguard", version: "1.0.0" },
      } });
    } else if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools } });
    } else if (method === "tools/call") {
      const n = byName[params?.name];
      if (!n) { send({ jsonrpc: "2.0", id, error: { code: -32601, message: "tool desconocida" } }); continue; }
      try {
        const res = await n.handle(params.arguments || {});
        send({ jsonrpc: "2.0", id, result: {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        } });
      } catch (e) {
        send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(e?.message || e) } });
      }
    } else if (method === "notifications/initialized") {
      // no-op
    } else if (id !== undefined) {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: "método no soportado" } });
    }
  }
}
main();
