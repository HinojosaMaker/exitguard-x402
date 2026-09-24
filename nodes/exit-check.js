// NODO AUTOEJECUTABLE: exit-check (liquidez de salida real via Jupiter).
// Es el unico nodo con RED: cotiza round-trip contra Jupiter. La logica de
// veredicto es PURA y testeable; la llamada de red es una prueba de integracion.
const SOL = "So11111111111111111111111111111111111111112";
const Q = "https://lite-api.jup.ag/swap/v1/quote";

// funcion pura exportada: mapea el retorno round-trip a un veredicto.
export function verdictFor(rt) {
  return rt <= -0.5 ? "TRAMPA" : rt <= -0.15 ? "PELIGRO" : rt <= -0.05 ? "ACEPTABLE" : "LIQUIDO";
}

async function quote(inMint, outMint, amount) {
  const r = await fetch(`${Q}?inputMint=${inMint}&outputMint=${outMint}&amount=${amount}&slippageBps=100`);
  if (r.status === 400) return { noRoute: true };
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

export default {
  id: "exit-check",
  price: "$0.01",
  params: ["mint", "sol"],
  description: "Chequeo de liquidez de salida de un token de Solana (round-trip ejecutable via Jupiter)",
  pure: false,                                            // depende de red
  async handle(q) {
    const mint = String(q.mint || "");
    const sol = Math.max(0.05, Math.min(50, Number(q.sol) || 1));
    if (mint.length < 32) return { error: "mint invalido" };
    const lamports = Math.round(sol * 1e9);
    const buy = await quote(SOL, mint, lamports);
    if (buy.noRoute) return { mint, sellable: false, verdict: "SIN_MERCADO" };
    const sell = await quote(mint, SOL, buy.outAmount);
    if (sell.noRoute) return { mint, sellable: false, verdict: "HONEYPOT" };
    const rt = (Number(sell.outAmount) - lamports) / lamports;
    const buyImpact = Number(buy.priceImpactPct || 0);
    return {
      mint, sellable: true, size_sol: sol,
      roundtrip_pct: +(rt * 100).toFixed(2),
      buy_impact_pct: +(buyImpact * 100).toFixed(3),
      safe_slippage_pct: +Math.max(1, buyImpact * 150 + 0.5).toFixed(1),
      verdict: verdictFor(rt), source: "jupiter",
    };
  },
  // AUTOTEST unitario: la tabla de veredictos (sin red).
  selfTest() {
    const checks = [
      { name: "-0.6 → TRAMPA", pass: verdictFor(-0.6) === "TRAMPA" },
      { name: "-0.2 → PELIGRO", pass: verdictFor(-0.2) === "PELIGRO" },
      { name: "-0.08 → ACEPTABLE", pass: verdictFor(-0.08) === "ACEPTABLE" },
      { name: "0.0 → LIQUIDO", pass: verdictFor(0.0) === "LIQUIDO" },
    ];
    return { ok: checks.every(c => c.pass), checks };
  },
};
