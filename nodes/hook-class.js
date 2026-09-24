// NODO AUTOEJECUTABLE: triaje de hooks Uniswap V4 por bits de permiso.
// Logica pura (sin red, sin estado) + metadatos + autotest. Portado de
// layer0-depin/src/sentinel/hooks.rs. Soltar este archivo en nodes/ basta:
// el registro le genera precio, ruta, entrada de descubrimiento y CI.

const FLAGS = [
  [1 << 13, "before_initialize"],      [1 << 12, "after_initialize"],
  [1 << 11, "before_add_liquidity"],   [1 << 10, "after_add_liquidity"],
  [1 <<  9, "before_remove_liquidity"],[1 <<  8, "after_remove_liquidity"],
  [1 <<  7, "before_swap"],            [1 <<  6, "after_swap"],
  [1 <<  5, "before_donate"],          [1 <<  4, "after_donate"],
  [1 <<  3, "before_swap_returns_delta"], [1 << 2, "after_swap_returns_delta"],
  [1 <<  1, "after_add_liq_returns_delta"], [1 << 0, "after_remove_liq_returns_delta"],
];
const CURVE_ALTERING = (1 << 3) | (1 << 2); // unicos bits que cambian la salida

// funcion pura, exportada para tests y reuso
export function classify(addr) {
  const clean = String(addr).trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(clean)) return null;
  const low = Number(BigInt(clean) & 0x3fffn);
  const isZero = /^0x0{40}$/.test(clean);
  const canAlter = (low & CURVE_ALTERING) !== 0 && !isZero;
  const klass = isZero ? "no_hook" : canAlter ? "opaque_custom_curve" : "modelable_standard";
  return {
    address: clean, bits: "0x" + low.toString(16).padStart(4, "0"),
    class: klass,
    quotable: klass === "no_hook" || klass === "modelable_standard",
    can_alter_swap: canAlter,
    flags: FLAGS.filter(([b]) => low & b).map(([, n]) => n),
  };
}

export default {
  id: "hook-class",
  price: "$0.01",
  params: ["address"],
  description: "Clasifica un hook Uniswap V4 (modelable vs. curva opaca) desde sus bits de permiso; dice si el pool se cotiza con matematica estandar",
  pure: true,
  // handler desacoplado de express: recibe query, devuelve cuerpo o {error}
  handle(q) {
    const r = classify(q.address || q.hook || "");
    if (!r) return { error: "direccion de hook invalida (esperado 0x + 40 hex)" };
    return {
      ...r,
      meaning: r.class === "opaque_custom_curve"
        ? "El hook puede reescribir la salida del swap: curva opaca, hay que simular su bytecode."
        : r.class === "modelable_standard"
          ? "Tiene hooks pero NO altera la curva: pool V4 estandar cotizable con matematica exacta. Menos competidores."
          : "Sin hook: V4 estandar puro.",
      method: "bits de permiso de la direccion (Uniswap V4 Hooks.sol), sin leer bytecode",
    };
  },
  // AUTOTEST: verificado 6/6 contra el frente real de Base y el motor Rust.
  selfTest() {
    const cases = [
      ["0x0000000000000000000000000000000000000000", "no_hook", true],
      ["0x0469a4bd3724dc86c9542f4694c976da13c450c0", "modelable_standard", true],
      ["0xbb7784a4d481184283ed89619a3e3ed143e1adc0", "modelable_standard", true],
      ["0xb429d62f8f3bffb98cdb9569533ea23bf0ba28cc", "opaque_custom_curve", false],
      ["0xbdf938149ac6a781f94faa0ed45e6a0e984c6544", "opaque_custom_curve", false],
      ["0x714defe1f839dbb060264df7ee61bf10ac6a40cc", "opaque_custom_curve", false],
    ];
    const checks = cases.map(([a, cls, q]) => {
      const r = classify(a);
      return { name: `${a.slice(0, 10)}..→${cls}`, pass: !!r && r.class === cls && r.quotable === q };
    });
    checks.push({ name: "direccion invalida → null", pass: classify("nope") === null });
    return { ok: checks.every(c => c.pass), checks };
  },
};
