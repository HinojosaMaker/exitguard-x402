// REGISTRO DE NODOS: la infraestructura que se genera sola.
// Lee nodes/*.js, y de sus metadatos deriva TODO: la config de pago x402, el
// montaje de rutas en Express, el manifiesto de descubrimiento del Bazaar y el
// arnes de autotests. Agregar un archivo de nodo genera su fase siguiente sin
// tocar nada mas: es el "motor autonomo" pedido, con una sola fuente de verdad.
import { readdirSync } from "fs";
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const NODES_DIR = join(HERE, "nodes");

// Carga y valida cada nodo. Un nodo mal formado NO tumba el motor: se reporta.
export async function loadNodes() {
  const nodes = [];
  const errors = [];
  for (const file of readdirSync(NODES_DIR).filter(f => f.endsWith(".js")).sort()) {
    try {
      const mod = await import(pathToFileURL(join(NODES_DIR, file)).href);
      const n = mod.default;
      if (!n || !n.id || typeof n.handle !== "function")
        throw new Error("nodo sin { id, handle }");
      n._file = file;
      nodes.push(n);
    } catch (e) {
      errors.push({ file, error: e.message });
    }
  }
  return { nodes, errors };
}

// -> config para paymentMiddleware de x402 (precio por ruta).
export function paymentConfig(nodes, network) {
  const cfg = {};
  for (const n of nodes)
    cfg["/" + n.id] = { price: n.price, network, config: { description: n.description, discoverable: true } };
  return cfg;
}

// -> monta cada nodo como ruta GET, contando pagos en STATS. Soporta handle
//    sincrono o async, y traduce {error} a HTTP 400.
export function mount(app, nodes, stats) {
  for (const n of nodes) {
    app.get("/" + n.id, async (req, res) => {
      try {
        const out = await n.handle(req.query);
        if (out && out.error) return res.status(400).json({ error: out.error });
        if (stats) { stats.paid++; stats.last_paid_ts = Date.now(); }
        res.json({ ...out, node: n.id, ts: Date.now() });
      } catch (e) {
        res.status(502).json({ error: "fallo del nodo", node: n.id, detail: String(e.message) });
      }
    });
  }
}

// -> manifiesto de descubrimiento (lo que leen agentes y el Bazaar).
export function discovery(nodes) {
  return nodes.map(n => ({ path: "/" + n.id, method: "GET", price: n.price, params: n.params || [], description: n.description }));
}

// -> corre el autotest de cada nodo. Base del CI y del /health en vivo.
export function runSelfTests(nodes) {
  const results = nodes.map(n => {
    if (typeof n.selfTest !== "function") return { id: n.id, ok: null, checks: [], note: "sin autotest" };
    try { const r = n.selfTest(); return { id: n.id, ok: r.ok, checks: r.checks || [] }; }
    catch (e) { return { id: n.id, ok: false, checks: [], error: e.message }; }
  });
  return { ok: results.every(r => r.ok !== false), results };
}
