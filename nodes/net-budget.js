// NODO AUTOEJECUTABLE: presupuesto neto de una operación con flash loan.
// Portado de la lógica del keeper (layer0-depin/src/keeper). Matemática entera-
// mente pura: un agente de arbitraje pasa bruto, prima del flash, gas y su
// beneficio mínimo, y sabe si la op SOBREVIVE tras costos y cuánto tip puede
// pagar SIN hundir el beneficio por debajo del mínimo. Nadie debería ejecutar
// un arb sin este cálculo; se lo vendemos hecho.
export function netBudget(gross, flashPremium, gas, tipShareBps, minProfit) {
  const g = Math.max(0, Number(gross) || 0);
  const fp = Math.max(0, Number(flashPremium) || 0);
  const gs = Math.max(0, Number(gas) || 0);
  const bps = Math.min(10000, Math.max(0, Number(tipShareBps) || 0));
  const min = Math.max(0, Number(minProfit) || 0);

  const netBeforeTip = g - fp - gs;                 // lo que queda tras costos duros
  // el tip SOLO sale del excedente por encima del beneficio mínimo: nunca hunde
  // una op rentable por debajo de su umbral.
  let tip = 0;
  if (netBeforeTip > min) tip = (netBeforeTip - min) * bps / 10000;
  const net = netBeforeTip - tip;
  const viable = net >= min && net > 0;

  return {
    gross: g, costs: { flash_premium: fp, gas: gs }, min_profit: min,
    net_before_tip: +netBeforeTip.toFixed(6),
    tip: +tip.toFixed(6), net_after_tip: +net.toFixed(6),
    viable, verdict: viable ? "EJECUTAR" : "DESCARTAR",
  };
}

export default {
  id: "net-budget",
  price: "$0.01",
  params: ["gross", "flash_premium", "gas", "tip_share_bps", "min_profit"],
  description: "Presupuesto neto de un arb con flash loan: net tras costos, tip pagable desde el excedente, y veredicto EJECUTAR/DESCARTAR sin hundir el beneficio mínimo",
  pure: true,
  handle(q) {
    return {
      ...netBudget(q.gross, q.flash_premium, q.gas, q.tip_share_bps, q.min_profit),
      note: "El tip sale solo del excedente sobre min_profit; jamás vuelve inviable una op rentable.",
    };
  },
  selfTest() {
    const a = netBudget(100, 5, 10, 5000, 20);   // neto 85, excedente 65, tip 32.5, net 52.5
    const b = netBudget(30, 5, 10, 5000, 20);    // neto 15 < min 20 → sin tip, DESCARTAR
    const c = netBudget(100, 90, 15, 5000, 5);   // neto -5 → DESCARTAR, sin tip
    const checks = [
      { name: "op rentable → EJECUTAR y tip>0", pass: a.viable === true && a.tip > 0 },
      { name: "tip no hunde bajo min_profit", pass: a.net_after_tip >= a.min_profit },
      { name: "neto bajo el mínimo → DESCARTAR sin tip", pass: b.viable === false && b.tip === 0 },
      { name: "costos > bruto → DESCARTAR", pass: c.viable === false && c.net_after_tip < 0 },
    ];
    return { ok: checks.every(c => c.pass), checks };
  },
};
