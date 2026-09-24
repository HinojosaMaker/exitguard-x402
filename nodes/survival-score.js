// NODO AUTOEJECUTABLE: score de supervivencia (data-moat de edge-lab).
// Modelo logistico ajustado sobre 39.895 lanzamientos (walk-forward AUC 0.718).
// La matematica es PURA y testeable; no toca la red.
const W = [-0.4045891837775749, 0.45842462384032273, -0.26145606380450837,
           0.47660132401444977, 0.19487710997248886];
const BASE = 0.02875046998370723;                       // tasa base de graduacion
const PRIOR_CORR = Math.log((1 - BASE) / BASE);         // ≈3.52, calibra a la base real

// funcion pura exportada: P(el token graduara), calibrada.
export function survivalProb(devBuy, serial, vsol) {
  const f = [1.0, Math.log1p(Math.max(0, devBuy)), serial,
             vsol / 50.0, devBuy / Math.max(1.0, vsol)];
  let z = 0; for (let i = 0; i < W.length; i++) z += W[i] * f[i];
  z = Math.max(-30, Math.min(30, z - PRIOR_CORR));
  return 1 / (1 + Math.exp(-z));
}

export default {
  id: "survival-score",
  price: "$0.02",
  params: ["dev_buy", "serial", "vsol"],
  description: "Probabilidad de supervivencia de un token al nacer, calibrada sobre dataset propio forward-measured (AUC 0.718)",
  pure: true,
  handle(q) {
    const devBuy = Number(q.dev_buy) || 0, serial = Number(q.serial) || 0, vsol = Number(q.vsol) || 0;
    const prob = survivalProb(devBuy, serial, vsol);
    const lift = +(prob / BASE).toFixed(2);
    return {
      survival_prob: +prob.toFixed(4), base_rate: +BASE.toFixed(4), lift_vs_base: lift,
      score: Math.round(prob * 100),
      band: lift >= 2.0 ? "ALTA" : lift >= 1.0 ? "MEDIA" : "BAJA",
      model: "logistic-fit-v1 (AUC 0.718, n=39895, walk-forward)",
      meaning: "P(graduara) calibrada; NO es senal de pump",
      inputs: { dev_buy: devBuy, serial, vsol },
    };
  },
  selfTest() {
    const p = survivalProb(3, 0, 45);
    const checks = [
      { name: "prob en (0,1)", pass: p > 0 && p < 1 },
      { name: "base_rate consistente", pass: Math.abs(BASE - 0.02875) < 1e-4 },
      // monotonia: mas dev_buy (dentro de rango) mueve la prob de forma estable
      { name: "determinista (misma entrada, misma salida)", pass: survivalProb(3, 0, 45) === p },
      { name: "serial alto baja la prob", pass: survivalProb(3, 3, 45) < survivalProb(3, 0, 45) },
    ];
    return { ok: checks.every(c => c.pass), checks };
  },
};
