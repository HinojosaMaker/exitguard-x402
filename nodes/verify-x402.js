// NODO: verify-x402 — LA CAPA DE CONFIANZA que nadie posee. Antes de que un agente
// pague a un servicio x402 desconocido, pregunta aqui: "es real? esta vivo? el reto
// de pago es valido? tiene track record?". No extrae de nadie: PROTEGE a los que
// pagan y LEGITIMA a los honestos. El que se vuelve este chequeo, captura el flujo
// entero de la economia de agentes sin robar un centavo. Se acepta porque pasar por
// aqui es lo que hace seguro el trato. Mide hechos verificables, no opina.
const UA = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };

// PURA: combina las senales de un sondeo en un veredicto de confianza 0-100.
export function trustScore(s) {
  let score = 0;
  if (s.reachable) score += 25;
  if (s.valid402) score += 30;          // devuelve un reto x402 bien formado
  if (s.hasDiscovery) score += 20;      // .well-known/x402.json publicado
  if (s.payToPresent) score += 15;      // dice a donde cobra (transparente)
  if (s.https) score += 10;
  const band = score >= 75 ? "CONFIABLE" : score >= 45 ? "CAUTELA" : "RIESGO";
  return { score, band };
}

async function probe(base) {
  const out = { reachable: false, valid402: false, hasDiscovery: false, payToPresent: false, https: base.startsWith("https://") };
  try {
    const r = await fetch(base.replace(/\/$/, "") + "/health", { headers: UA, signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (r && r.ok) out.reachable = true;
  } catch {}
  try {
    const d = await fetch(base.replace(/\/$/, "") + "/.well-known/x402.json", { headers: UA, signal: AbortSignal.timeout(12000) });
    if (d.ok) { out.hasDiscovery = true; out.reachable = true; }
  } catch {}
  return out;
}
// sondea un endpoint concreto para ver si su 402 es real
async function probe402(url) {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) });
    if (r.status === 402) {
      const hdr = r.headers.get("payment-required") || r.headers.get("www-authenticate");
      let body = null; try { body = await r.json(); } catch {}
      const accepts = body?.accepts || [];
      const payTo = accepts[0]?.payTo || "";
      return { valid402: !!(hdr || accepts.length), payToPresent: /^0x[0-9a-fA-F]{40}$|^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payTo), payTo };
    }
    return { valid402: false, payToPresent: false, note: "no devolvio 402 (status " + r.status + ")" };
  } catch (e) { return { valid402: false, payToPresent: false, note: String(e.message).slice(0, 60) }; }
}

export default {
  id: "verify-x402",
  price: "$0.02",
  params: ["url"],
  description: "Verifica un servicio x402 ANTES de pagarle: vivo, reto de pago valido, discovery publicado, a donde cobra. Devuelve score de confianza 0-100. La capa de confianza de la economia de agentes.",
  pure: false,
  async handle(q) {
    const url = String(q.url || "").trim();
    if (!/^https?:\/\/.+/.test(url)) return { error: "pasa una url http(s) del servicio o endpoint x402" };
    const base = url.replace(/(\/[^/]*)?$/, "").match(/^https?:\/\/[^/]+/)?.[0] || url;
    const [b, e] = await Promise.all([probe(base), probe402(url)]);
    const signals = { ...b, valid402: e.valid402, payToPresent: e.payToPresent };
    const t = trustScore(signals);
    return {
      url, cobra_a: e.payTo || null,
      ...t,
      senales: { alcanzable: signals.reachable, reto_402_valido: signals.valid402,
        discovery_publicado: signals.hasDiscovery, destino_de_pago_visible: signals.payToPresent, https: signals.https },
      nota: e.note || (t.band === "CONFIABLE" ? "servicio x402 real y transparente" : "faltan senales de confianza"),
      disclaimer: "mide senales verificables de infraestructura, no garantiza la calidad del dato que vende.",
    };
  },
  selfTest() {
    const c = [
      { n: "todo ok -> CONFIABLE", ok: trustScore({ reachable: 1, valid402: 1, hasDiscovery: 1, payToPresent: 1, https: 1 }).band === "CONFIABLE" },
      { n: "solo vivo -> RIESGO", ok: trustScore({ reachable: 1 }).band === "RIESGO" },
      { n: "vivo+402 -> CAUTELA", ok: trustScore({ reachable: 1, valid402: 1 }).band === "CAUTELA" },
    ];
    return { ok: c.every(x => x.ok), checks: c };
  },
};
