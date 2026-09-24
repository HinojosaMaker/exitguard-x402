// NODO AUTOEJECUTABLE: carry-scan — el mapa del rio de funding.
// Hyperliquid paga ~$1.45B/ano en funding (medido 2026-09-23: $165k/HORA sobre
// $12.7B de OI). Ese flujo existe pase lo que pase con el precio: es el pago
// estructural que los apalancados hacen a quien toma el otro lado.
//
// Este nodo responde la pregunta que decide si un carry vale: NO "cuanto rinde"
// sino "cuantas HORAS tengo que aguantar solo para pagar las fees". Un funding de
// 200%/anual no vale nada si tu breakeven es 8h y el signo voltea en 3h.
// De 234 mercados, tipicamente 2-5 pasan. El valor esta en los 230 que descarta.
const API = "https://api.hyperliquid.xyz/info";
const FEE_POR_LADO = 0.00045;      // taker Hyperliquid
const LADOS = 4;                   // abrir perp+spot, cerrar perp+spot

// funcion PURA: horas que aguantar para que el funding pague el roundtrip.
export function horasBreakeven(fundingHora) {
  const f = Math.abs(fundingHora);
  if (!(f > 0)) return Infinity;
  return (FEE_POR_LADO * LADOS) / f;
}

export function evaluar({ fundingHora, oiUsd }, minOi = 1e6, maxHoras = 24) {
  if (oiUsd < minOi) return { operable: false, motivo: `OI $${Math.round(oiUsd).toLocaleString()} < minimo` };
  if (Math.abs(fundingHora) < 0.00005) return { operable: false, motivo: "funding demasiado bajo" };
  const h = horasBreakeven(fundingHora);
  if (h > maxHoras) return { operable: false, motivo: `breakeven ${h.toFixed(1)}h > ${maxHoras}h` };
  return {
    operable: true,
    horas_breakeven: +h.toFixed(1),
    lado: fundingHora > 0 ? "SHORT perp + LONG spot" : "LONG perp + SHORT spot",
  };
}

export default {
  id: "carry-scan",
  price: "$0.02",
  params: ["min_oi_usd", "max_horas"],
  description: "Mapa del funding carry en Hyperliquid: de 234 perps, cuales son OPERABLES market-neutral, con su breakeven en HORAS tras fees reales. Market-neutral: no predice direccion, mide el pago estructural.",
  pure: false,
  async handle(q) {
    const minOi = Number(q.min_oi_usd) || 1e6;
    const maxHoras = Number(q.max_horas) || 24;
    let d;
    try {
      const r = await fetch(API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      d = await r.json();
    } catch (e) {
      return { error: "Hyperliquid no responde: " + e.message };
    }
    const [meta, ctxs] = d;
    const filas = [];
    let rioHora = 0, oiTotal = 0;
    meta.universe.forEach((m, i) => {
      const c = ctxs[i]; if (!c || c.funding == null) return;
      const fh = Number(c.funding), px = Number(c.markPx || 0);
      const oiUsd = Number(c.openInterest || 0) * px;
      rioHora += Math.abs(fh) * oiUsd; oiTotal += oiUsd;
      const ev = evaluar({ fundingHora: fh, oiUsd }, minOi, maxHoras);
      if (ev.operable) filas.push({
        sym: m.name, funding_anual_pct: +(fh * 24 * 365 * 100).toFixed(1),
        oi_usd: Math.round(oiUsd), ...ev,
      });
    });
    filas.sort((a, b) => Math.abs(b.funding_anual_pct) - Math.abs(a.funding_anual_pct));
    return {
      mercados_escaneados: meta.universe.length,
      operables: filas.length,
      descartados: meta.universe.length - filas.length,
      coste_roundtrip_pct: +(FEE_POR_LADO * LADOS * 100).toFixed(4),
      rio_funding_usd_hora: Math.round(rioHora),
      rio_funding_usd_ano: Math.round(rioHora * 24 * 365),
      oi_total_usd: Math.round(oiTotal),
      top: filas.slice(0, 10),
      riesgo: "el signo del funding puede voltear antes del breakeven; el leg spot requiere capital; liquidacion si falta margen",
      source: "hyperliquid",
    };
  },
  selfTest() {
    const checks = [
      { name: "breakeven 0.0001/h -> 18h", pass: Math.abs(horasBreakeven(0.0001) - 18) < 0.1 },
      { name: "funding 0 -> Infinity", pass: horasBreakeven(0) === Infinity },
      { name: "OI bajo -> no operable", pass: evaluar({ fundingHora: 0.0003, oiUsd: 1e5 }).operable === false },
      { name: "funding alto + OI alto -> operable", pass: evaluar({ fundingHora: 0.0003, oiUsd: 1e7 }).operable === true },
      { name: "funding+ -> SHORT perp", pass: evaluar({ fundingHora: 0.0003, oiUsd: 1e7 }).lado.startsWith("SHORT") },
      { name: "funding- -> LONG perp", pass: evaluar({ fundingHora: -0.0003, oiUsd: 1e7 }).lado.startsWith("LONG") },
    ];
    return { ok: checks.every(c => c.pass), checks };
  },
};
