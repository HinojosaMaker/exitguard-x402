// NODO AUTOEJECUTABLE: rent-scan — infra de VALOR IGNORADO (VEXA OMNI Fase 1).
// Revela cuánto SOL de "rent" arrastra una wallet en cuentas de token VACÍAS
// (recuperable cerrándolas). Un agente gestor de carteras paga por este dato.
// Mide, no cierra: cerrar requiere la firma del dueño. VALOR VISIBLE ≠ PROPIO.
const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const RENT_POR_CUENTA = 0.00203928;   // SOL bloqueado por cuenta (rent-exempt mínimo)
const COSTE_CIERRE = 0.000005;        // fee aprox de closeAccount por cuenta

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) throw new Error("RPC " + r.status);
  return (await r.json()).result;
}

// función PURA: economía neta del cierre. Testeable sin red.
export function economia(vacias) {
  const bruto = vacias * RENT_POR_CUENTA;
  const coste = vacias * COSTE_CIERRE;
  return {
    bruto_sol: +bruto.toFixed(6),
    coste_sol: +coste.toFixed(6),
    neto_sol: +(bruto - coste).toFixed(6),
    ratio: coste ? Math.round(bruto / coste) : null,
  };
}

export default {
  id: "rent-scan",
  price: "$0.01",
  params: ["wallet"],
  description: "Revela el SOL de rent recuperable en las cuentas de token vacías de una wallet Solana (valor ignorado, net-positivo). Mide; el cierre lo firma el dueño.",
  pure: false,
  async handle(q) {
    const wallet = String(q.wallet || "");
    if (wallet.length < 32) return { error: "wallet invalida" };
    let r;
    try {
      r = await rpc("getTokenAccountsByOwner",
        [wallet, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }]);
    } catch (e) {
      return { wallet, error: "no se pudo leer la cadena: " + e.message };
    }
    const cuentas = (r?.value) || [];
    let vacias = 0, conSaldo = 0;
    const cerrables = [];
    for (const c of cuentas) {
      const amt = Number(c.account.data.parsed.info.tokenAmount.uiAmount || 0);
      if (amt === 0) { vacias++; if (cerrables.length < 10) cerrables.push(c.pubkey); }
      else conSaldo++;
    }
    return {
      wallet,
      cuentas_token: cuentas.length,
      con_saldo: conSaldo,
      vacias_recuperables: vacias,
      economia: economia(vacias),
      cuentas_a_cerrar: cerrables,
      nota: "recuperable SOLO con la firma del dueño. Valor visible, no propio.",
      source: "solana-chain",
    };
  },
  selfTest() {
    const e = economia(10);
    const checks = [
      { name: "10 cuentas → bruto 0.0203928", pass: Math.abs(e.bruto_sol - 0.020393) < 1e-4 },
      { name: "net positivo", pass: e.neto_sol > 0 },
      { name: "ratio ~408x", pass: e.ratio >= 400 && e.ratio <= 410 },
      { name: "0 cuentas → 0", pass: economia(0).neto_sol === 0 },
    ];
    return { ok: checks.every((c) => c.pass), checks };
  },
};
