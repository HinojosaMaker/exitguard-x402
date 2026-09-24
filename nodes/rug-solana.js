// NODO AUTOEJECUTABLE: rug-solana — chequeo de rug PRE-compra en Solana.
// Lee de la cadena las dos señales que un agente NO puede ver en el precio y que
// deciden si un token es una trampa estructural, no de liquidez:
//   - mintAuthority != null  -> el dev puede ACUÑAR infinitos y diluirte a cero.
//   - freezeAuthority != null -> el dev puede CONGELAR tus tokens: compras y no vendes.
// Más la concentración del top holder (riesgo de dump). GoPlus/Blockaid van sobre
// EVM; esto es nativo Solana y se lee del mint account, no de un oráculo.
const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) throw new Error("RPC " + r.status);
  return (await r.json()).result;
}

// función PURA: combina las señales en un score 0-100 (0 = trampa, 100 = limpio).
export function scoreRug({ mintAuth, freezeAuth, topPct }) {
  let score = 100;
  const flags = [];
  if (mintAuth) { score -= 45; flags.push("MINT_ABIERTO: el dev puede acuñar más y diluirte"); }
  if (freezeAuth) { score -= 45; flags.push("FREEZE_ABIERTO: el dev puede congelar tus tokens"); }
  if (topPct >= 50) { score -= 25; flags.push(`TOP_HOLDER ${topPct}%: un dump te hunde`); }
  else if (topPct >= 25) { score -= 12; flags.push(`TOP_HOLDER ${topPct}%: concentración alta`); }
  score = Math.max(0, score);
  const verdict = score >= 80 ? "LIMPIO" : score >= 50 ? "RIESGO" : "TRAMPA";
  return { score, verdict, flags };
}

export default {
  id: "rug-solana",
  price: "$0.02",
  params: ["mint"],
  description: "Rug-check pre-compra de un token Solana: autoridad de acuñado/congelado + concentración del top holder, leído de la cadena.",
  pure: false,
  async handle(q) {
    const mint = String(q.mint || "");
    if (mint.length < 32) return { error: "mint invalido" };
    let info, largest;
    try {
      info = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
      largest = await rpc("getTokenLargestAccounts", [mint]);
    } catch (e) {
      return { mint, error: "no se pudo leer la cadena: " + e.message };
    }
    const parsed = info?.value?.data?.parsed?.info;
    if (!parsed) return { mint, error: "no es un mint SPL válido" };
    const mintAuth = parsed.mintAuthority || null;
    const freezeAuth = parsed.freezeAuthority || null;
    const supply = Number(parsed.supply || 0) / 10 ** (parsed.decimals || 0);
    const holders = (largest?.value || []).map((h) => Number(h.uiAmount || 0));
    const topPct = supply > 0 && holders.length ? +(100 * holders[0] / supply).toFixed(1) : 0;
    const r = scoreRug({ mintAuth, freezeAuth, topPct });
    return {
      mint,
      mint_authority: mintAuth ? "ABIERTA" : "revocada",
      freeze_authority: freezeAuth ? "ABIERTA" : "revocada",
      top_holder_pct: topPct,
      rug_score: r.score,
      verdict: r.verdict,
      flags: r.flags,
      source: "solana-chain",
    };
  },
  selfTest() {
    const clean = scoreRug({ mintAuth: null, freezeAuth: null, topPct: 10 });
    const trap = scoreRug({ mintAuth: "X", freezeAuth: "Y", topPct: 60 });
    const conc = scoreRug({ mintAuth: null, freezeAuth: null, topPct: 55 });
    const checks = [
      { name: "limpio → LIMPIO/100", pass: clean.verdict === "LIMPIO" && clean.score === 100 },
      { name: "mint+freeze+conc → TRAMPA", pass: trap.verdict === "TRAMPA" },
      { name: "solo concentración alta → RIESGO", pass: conc.verdict === "RIESGO" },
    ];
    return { ok: checks.every((c) => c.pass), checks };
  },
};
