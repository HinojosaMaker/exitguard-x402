// NODO AUTOEJECUTABLE: escape-curve — LA CURVA DE ESCAPE como oraculo pagable.
// No existe en ninguna otra herramienta. exit-check dice si sales a UN tamano;
// esto mide la salida EJECUTABLE a tamanos crecientes y devuelve el UMBRAL en $
// donde el token deja de ser vendible. Cliente: bots que van a comprar y quieren
// saber ANTES cuanto capital pueden meter sin quedar atrapados. Mide, no adivina.
const SOL = "So11111111111111111111111111111111111111112";
const Q = "https://lite-api.jup.ag/swap/v1/quote";

// funcion PURA exportada: dada la curva [{sol, rt_pct}], devuelve el mayor tamano
// cuyo round-trip sigue por encima del umbral (contiguo desde el mas pequeno).
export function maxSafeSize(curva, umbralPct = -12) {
  let max = 0;
  for (const p of curva.slice().sort((a, b) => a.sol - b.sol)) {
    if (p.rt_pct === null) break;          // sin ruta a ese tamano: se acabo
    if (p.rt_pct < umbralPct) break;       // ya no sales barato: frontera
    max = p.sol;
  }
  return max;
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

export default {
  id: "escape-curve",
  price: "$0.03",                       // mas caro que exit-check: mide N tamanos
  params: ["mint", "sol_usd"],
  description: "Curva de Escape: umbral maximo en $ al que un token de Solana sigue siendo vendible (round-trip ejecutable a tamanos crecientes). Unico en su clase.",
  pure: false,
  async handle(q) {
    const mint = String(q.mint || "");
    if (mint.length < 32) return { error: "mint invalido" };
    const solUsd = Math.max(1, Math.min(1000, Number(q.sol_usd) || 200));
    const sizes = [0.05, 0.25, 1, 3, 10, 30];   // SOL
    const curva = [];
    for (const s of sizes) {
      let v = null;
      try { v = await rt(mint, s); } catch { v = null; }
      curva.push({ sol: s, usd: +(s * solUsd).toFixed(0), rt_pct: v === null ? null : +v.toFixed(2) });
      if (v === null) break;                      // sin salida ya: no probar mas grande
    }
    const maxSol = maxSafeSize(curva);
    return {
      mint,
      curva,
      max_salida_segura_sol: maxSol,
      max_salida_segura_usd: +(maxSol * solUsd).toFixed(0),
      veredicto: maxSol === 0 ? "TRAMPA_TOTAL" : maxSol >= 30 ? "LIQUIDO_PROFUNDO" : maxSol >= 3 ? "OPERABLE" : "SOLO_MICRO",
      source: "jupiter",
    };
  },
  // AUTOTEST: la logica pura de frontera (sin red).
  selfTest() {
    const c1 = [{ sol: 0.05, rt_pct: -2 }, { sol: 0.25, rt_pct: -8 }, { sol: 1, rt_pct: -40 }, { sol: 3, rt_pct: -90 }];
    const c2 = [{ sol: 0.05, rt_pct: -80 }];
    const c3 = [{ sol: 0.05, rt_pct: -1 }, { sol: 0.25, rt_pct: -3 }, { sol: 1, rt_pct: -5 }];
    const checks = [
      { name: "frontera en 0.25 (umbral -12)", pass: maxSafeSize(c1) === 0.25 },
      { name: "trampa total → 0", pass: maxSafeSize(c2) === 0 },
      { name: "todo liquido → mayor tamano", pass: maxSafeSize(c3) === 1 },
      { name: "corta en null", pass: maxSafeSize([{ sol: 0.05, rt_pct: -1 }, { sol: 0.25, rt_pct: null }]) === 0.05 },
    ];
    return { ok: checks.every(c => c.pass), checks };
  },
};
