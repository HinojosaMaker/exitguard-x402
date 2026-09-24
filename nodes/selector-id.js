// NODO AUTOEJECUTABLE (demo de auto-cableado): identifica un selector de 4 bytes.
// Se suelta este archivo y el registro le da precio, ruta, descubrimiento, CI y
// /health SIN tocar ningún otro archivo. Es la "fase siguiente" generándose sola.
const KNOWN = {
  "a9059cbb": ["transfer(address,uint256)", "value_move"],
  "23b872dd": ["transferFrom(address,address,uint256)", "value_move"],
  "095ea7b3": ["approve(address,uint256)", "value_move"],
  "d505accf": ["permit(...)", "value_move"],
  "ac9650d8": ["multicall(bytes[])", "wrapper"],
  "3d93564c": ["execute(bytes,bytes[])", "wrapper"],
  "38ed1739": ["swapExactTokensForTokens(...)", "swap"],
  "414bf389": ["exactInputSingle(...)", "swap"],
  "04e45aab": ["exactInputSingle(...)", "swap"],
};
export function identify(sel) {
  const s = String(sel).trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{8}$/.test(s)) return null;
  const hit = KNOWN[s];
  return { selector: "0x" + s, known: !!hit, name: hit ? hit[0] : null, category: hit ? hit[1] : "unknown" };
}

export default {
  id: "selector-id",
  price: "$0.005",
  params: ["selector"],
  description: "Identifica un selector de función de 4 bytes: nombre y categoría (value_move/wrapper/swap/unknown)",
  pure: true,
  handle(q) {
    const r = identify(q.selector || q.sel || "");
    if (!r) return { error: "selector invalido (esperado 4 bytes hex, p.ej. 0xa9059cbb)" };
    return { ...r, meaning: r.category === "value_move" ? "mueve valor: peligroso si no está permitido" : `categoría: ${r.category}` };
  },
  selfTest() {
    const checks = [
      { name: "transfer → value_move", pass: identify("0xa9059cbb").category === "value_move" },
      { name: "multicall → wrapper", pass: identify("38ed1739") && identify("ac9650d8").category === "wrapper" },
      { name: "desconocido → unknown", pass: identify("0x12345678").category === "unknown" },
      { name: "invalido → null", pass: identify("nope") === null },
    ];
    return { ok: checks.every(c => c.pass), checks };
  },
};
