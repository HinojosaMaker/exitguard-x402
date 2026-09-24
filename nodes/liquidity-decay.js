// NODO: liquidity-decay — detecta un RUG EN PROGRESO. No mira el precio (mentira);
// mide la liquidez de SALIDA ejecutable dos veces con segundos de diferencia y
// reporta si se esta SECANDO (derivada negativa) = alguien esta retirando el pool
// AHORA. Un bot que consulta esto antes de comprar evita entrar a una trampa que
// se esta cerrando. Nadie vende esto. Mide hechos, no adivina.
const SOL = "So11111111111111111111111111111111111111112";
const Q = "https://lite-api.jup.ag/swap/v1/quote";

// PURA: clasifica la tendencia de la liquidez desde dos muestras de round-trip.
export function decayVerdict(rtEarly, rtLate) {
  if (rtEarly === null || rtLate === null) return "SIN_SALIDA";
  const delta = rtLate - rtEarly;              // puntos porcentuales
  if (delta <= -3) return "SECANDOSE_RAPIDO";  // rug/retiro en curso
  if (delta <= -0.8) return "SECANDOSE";
  if (delta >= 0.8) return "PROFUNDIZANDO";    // entra liquidez
  return "ESTABLE";
}

async function quote(inMint, outMint, amount) {
  const r = await fetch(`${Q}?inputMint=${inMint}&outputMint=${outMint}&amount=${amount}&slippageBps=500`);
  if (r.status === 400) return { noRoute: true };
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
async function rt(mint, sol) {
  const lam = Math.round(sol * 1e9);
  const buy = await quote(SOL, mint, lam);
  if (buy.noRoute || !(Number(buy.outAmount) > 0)) return null;
  const sell = await quote(mint, SOL, buy.outAmount);
  if (sell.noRoute) return null;
  return (Number(sell.outAmount) - lam) / lam * 100;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  id: "liquidity-decay",
  price: "$0.04",                       // el mas caro: dos muestras temporales
  params: ["mint", "sol"],
  description: "Detecta un rug EN PROGRESO: mide si la liquidez de salida ejecutable de un token Solana se esta secando ahora mismo (derivada temporal). Unico.",
  pure: false,
  async handle(q) {
    const mint = String(q.mint || "");
    if (mint.length < 32) return { error: "mint invalido" };
    const sol = Math.max(0.05, Math.min(20, Number(q.sol) || 1));
    const t0 = await rt(mint, sol);
    await sleep(6000);                   // ventana temporal
    const t1 = await rt(mint, sol);
    const v = decayVerdict(t0, t1);
    return {
      mint, size_sol: sol,
      rt_inicial_pct: t0 === null ? null : +t0.toFixed(2),
      rt_final_pct: t1 === null ? null : +t1.toFixed(2),
      cambio_pp: (t0 === null || t1 === null) ? null : +(t1 - t0).toFixed(2),
      veredicto: v,
      accion: (v === "SECANDOSE_RAPIDO" || v === "SIN_SALIDA") ? "NO_COMPRAR" :
              v === "SECANDOSE" ? "PRECAUCION" : "OK",
      source: "jupiter",
    };
  },
  selfTest() {
    const c = [
      { n: "-5pp → rapido", ok: decayVerdict(-2, -7) === "SECANDOSE_RAPIDO" },
      { n: "-1pp → secandose", ok: decayVerdict(-1, -2) === "SECANDOSE" },
      { n: "+1pp → profundiza", ok: decayVerdict(-3, -1.5) === "PROFUNDIZANDO" },
      { n: "estable", ok: decayVerdict(-1, -1.2) === "ESTABLE" },
      { n: "sin ruta", ok: decayVerdict(-1, null) === "SIN_SALIDA" },
    ];
    return { ok: c.every(x => x.ok), checks: c };
  },
};
