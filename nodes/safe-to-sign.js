// NODO COMPOSITOR: une varios nodos en UN solo veredicto pre-firma.
// Importa las funciones puras de los otros nodos (unificación real en código):
// un agente que va a firmar un swap hace UNA llamada y sabe, sin simular nada,
// si (a) el calldata no esconde un drainer Y (b) el pool es cotizable.
// Es el chequeo ESTÁTICO que se corre ANTES de gastar en una simulación.
import { audit } from "./calldata-audit.js";
import { classify } from "./hook-class.js";

export default {
  id: "safe-to-sign",
  price: "$0.03",
  params: ["calldata", "hook", "allow", "strict"],
  description: "Veredicto pre-firma unificado: audita el calldata (drainers) y clasifica el hook V4 (cotizable vs. opaco) en una sola llamada estática, sin simular",
  pure: true,
  handle(q) {
    const allow = String(q.allow || "").split(",").map(s => s.trim()).filter(Boolean);
    const strict = q.strict === "1" || q.strict === "true";
    const cd = audit(String(q.calldata || q.data || ""), allow, strict);
    if (cd.error) return { error: cd.error };

    // el hook es opcional; si no viene, ese eje no bloquea.
    const hookAddr = q.hook || q.pool_hook || "";
    const hook = hookAddr ? classify(hookAddr) : null;
    if (hookAddr && !hook) return { error: "direccion de hook invalida (esperado 0x + 40 hex)" };

    const calldataSafe = cd.safe;
    const hookOk = !hook || hook.quotable;       // sin hook = ok; con hook = solo si cotizable
    const safe = calldataSafe && hookOk;

    const reasons = [];
    if (!calldataSafe) reasons.push("el calldata mueve o esconde valor (posible drainer)");
    if (hook && !hook.quotable) reasons.push("el pool usa un hook de curva opaca (no modelable sin simular su bytecode)");

    return {
      safe, verdict: safe ? "FIRMABLE" : "NO_FIRMAR",
      checks: {
        calldata: { safe: calldataSafe, findings: cd.findings },
        hook: hook ? { class: hook.class, quotable: hook.quotable } : "no_evaluado",
      },
      reasons: reasons.length ? reasons : ["ningún eje estático bloquea la firma"],
      note: "Chequeo estático (AST + bits de hook). No simula ni ejecuta: complementa, no reemplaza, una simulación.",
    };
  },
  selfTest() {
    const w = n => BigInt(n).toString(16).padStart(64, "0");
    const pad = a => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
    const ATT = "0x00000000000000000000000000000000deadbeef";
    const transfer = "a9059cbb" + pad(ATT) + w(1000);
    const swap = "414bf389" + w(1) + w(2) + pad(ATT) + w(500);
    const A = "414bf389";
    const MODELABLE = "0x0469a4bd3724dc86c9542f4694c976da13c450c0";
    const OPAQUE = "0xb429d62f8f3bffb98cdb9569533ea23bf0ba28cc";
    const self = { handle: this.handle };
    const checks = [
      { name: "swap limpio + hook modelable → FIRMABLE",
        pass: self.handle({ calldata: swap, allow: A, hook: MODELABLE }).safe === true },
      { name: "swap limpio + hook opaco → NO_FIRMAR",
        pass: self.handle({ calldata: swap, allow: A, hook: OPAQUE }).safe === false },
      { name: "drainer + hook modelable → NO_FIRMAR (el calldata manda)",
        pass: self.handle({ calldata: transfer, allow: A, hook: MODELABLE }).safe === false },
      { name: "swap limpio sin hook → FIRMABLE",
        pass: self.handle({ calldata: swap, allow: A }).safe === true },
    ];
    return { ok: checks.every(c => c.pass), checks };
  },
};
