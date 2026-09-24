// NODO AUTOEJECUTABLE: solana-gate — LA CRIBA. Un solo veredicto GO/NO-GO que un
// agente pide ANTES de cualquier compra en Solana. Fusiona en una llamada las dos
// preguntas que hunden al 94%:
//   1) ¿se puede VENDER? (round-trip ejecutable via Jupiter, a tu tamaño)
//   2) ¿es un rug estructural? (autoridad de acuñado/congelado + concentración)
// Barata a propósito ($0.01): la criba gana por VOLUMEN — estar en el camino de
// cada trade —, no por precio. El colador que todos atraviesan.
import exitNode, { verdictFor } from "./exit-check.js";
import rugNode, { scoreRug } from "./rug-solana.js";

// función PURA: fusiona los dos veredictos en una decisión. Es lo testeable.
export function decide({ rt, rugScore, sellable }) {
  if (sellable === false) return { go: false, reason: "no se puede vender (sin mercado u honeypot)" };
  const exitBad = rt <= -0.15;            // salida cara/trampa
  const rugBad = rugScore < 50;           // TRAMPA estructural
  if (rugBad && exitBad) return { go: false, reason: "rug + salida mala: doble trampa" };
  if (rugBad) return { go: false, reason: "rug estructural (mint/freeze/concentración)" };
  if (exitBad) return { go: false, reason: "la salida se come la posición" };
  if (rt <= -0.05 || rugScore < 80) return { go: true, reason: "pasable con cautela", caution: true };
  return { go: true, reason: "limpio en salida y estructura" };
}

export default {
  id: "solana-gate",
  price: "$0.01",
  params: ["mint", "sol"],
  description: "LA CRIBA pre-compra Solana: un GO/NO-GO que fusiona salida ejecutable (¿se puede vender?) y rug on-chain (¿acuñado/congelado/concentración?) en una sola llamada.",
  pure: false,
  async handle(q) {
    const mint = String(q.mint || "");
    if (mint.length < 32) return { error: "mint invalido" };
    // reusa los nodos existentes: una criba compone, no reimplementa
    const [exit, rug] = await Promise.all([
      exitNode.handle({ mint, sol: q.sol || 1 }),
      rugNode.handle({ mint }),
    ]);
    const rt = typeof exit.roundtrip_pct === "number" ? exit.roundtrip_pct / 100 : -1;
    const d = decide({ rt, rugScore: rug.rug_score ?? 0, sellable: exit.sellable });
    return {
      mint,
      decision: d.go ? (d.caution ? "GO_CAUTELA" : "GO") : "NO_GO",
      reason: d.reason,
      exit: { sellable: exit.sellable, roundtrip_pct: exit.roundtrip_pct, verdict: exit.verdict },
      rug: { score: rug.rug_score, verdict: rug.verdict, flags: rug.flags },
      source: "solana-gate/compose",
    };
  },
  selfTest() {
    const checks = [
      { name: "honeypot → NO_GO", pass: decide({ sellable: false }).go === false },
      { name: "rug+salida → NO_GO", pass: decide({ rt: -0.3, rugScore: 20, sellable: true }).go === false },
      { name: "solo rug → NO_GO", pass: decide({ rt: -0.02, rugScore: 20, sellable: true }).go === false },
      { name: "limpio → GO", pass: decide({ rt: -0.01, rugScore: 100, sellable: true }).go === true },
      { name: "borderline → GO_CAUTELA", pass: decide({ rt: -0.02, rugScore: 70, sellable: true }).caution === true },
    ];
    return { ok: checks.every((c) => c.pass), checks };
  },
};
