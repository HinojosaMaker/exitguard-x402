// EXIT RADAR — valor publico y gratis que atrae por si mismo. Corre el taladro
// (curva de escape sobre el firehose de Solana) en segundo plano, cachea, y sirve
// una pagina limpia: que tokens SE PUEDEN VENDER vs TRAMPA, en vivo. Es el funnel:
// valor real gratis para humanos/agentes -> profundidad en los oraculos de pago.
const SOL = "So11111111111111111111111111111111111111112";
const JUP = "https://lite-api.jup.ag/swap/v1/quote";
const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
const UA = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
let CACHE = { ts: 0, rows: [], scanning: false };

async function jget(u) {
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
async function rt(mint, sol) {
  try {
    const lam = Math.round(sol * 1e9);
    const b = await jget(`${JUP}?inputMint=${SOL}&outputMint=${mint}&amount=${lam}&slippageBps=500`);
    if (!(Number(b.outAmount) > 0)) return null;
    const s = await jget(`${JUP}?inputMint=${mint}&outputMint=${SOL}&amount=${b.outAmount}&slippageBps=500`);
    if (!(Number(s.outAmount) > 0)) return null;
    return (Number(s.outAmount) - lam) / lam * 100;
  } catch { return null; }
}
async function escape(mint) { // mayor $ con round-trip > -12%
  let max = 0;
  for (const s of [0.05, 0.25, 1, 3]) { const v = await rt(mint, s); if (v === null || v < -12) break; max = s; }
  return max;
}
async function scan() {
  if (CACHE.scanning) return;
  CACHE.scanning = true;
  try {
    const seen = [];
    for (const feed of ["trending_pools?duration=1h", "new_pools?page=1"]) {
      try { for (const p of (await jget(`${GT}/${feed}`)).data) {
        const m = p.relationships.base_token.data.id.split("_")[1];
        const nm = (p.attributes.name || "").split(" /")[0];
        if (m && m.length >= 32 && m !== SOL && !seen.find(x => x.mint === m)) seen.push({ mint: m, sym: nm });
      } } catch {}
    }
    const rows = [];
    for (const t of seen.slice(0, 14)) {
      const maxSol = await escape(t.mint);
      rows.push({ ...t, salida_usd: Math.round(maxSol * 200),
        veredicto: maxSol === 0 ? "TRAMPA" : maxSol >= 3 ? "LIQUIDO" : "MICRO" });
    }
    CACHE = { ts: Date.now(), rows, scanning: false };
  } catch { CACHE.scanning = false; }
}
function loop() { scan(); setInterval(scan, 8 * 60 * 1000); } // refresco cada 8 min

function page() {
  const age = CACHE.ts ? Math.round((Date.now() - CACHE.ts) / 60000) : "—";
  const ok = CACHE.rows.filter(r => r.veredicto !== "TRAMPA");
  const trap = CACHE.rows.filter(r => r.veredicto === "TRAMPA");
  const row = r => `<tr class="${r.veredicto}"><td>${r.sym || r.mint.slice(0,6)}</td><td>${r.veredicto}</td><td>${r.salida_usd ? "$"+r.salida_usd : "—"}</td><td class=m>${r.mint}</td></tr>`;
  return `<!doctype html><html lang=es><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Exit Radar · ¿puedes salir de ese token?</title><style>
:root{color-scheme:dark}body{font:15px system-ui,sans-serif;background:#0a0d12;color:#e6e8eb;margin:0;padding:20px;max-width:900px;margin:auto}
h1{font-size:22px;margin:0 0 4px}.sub{color:#8b95a3;font-size:13px;margin:0 0 18px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #1a212c}
th{color:#9aa4b2;font-size:11px;text-transform:uppercase}.m{font-family:monospace;font-size:11px;color:#6b7684;word-break:break-all}
tr.TRAMPA td:nth-child(2){color:#ef4444;font-weight:700}tr.LIQUIDO td:nth-child(2){color:#22c55e;font-weight:700}tr.MICRO td:nth-child(2){color:#f59e0b}
.card{background:#111722;border:1px solid #1e2632;border-radius:12px;padding:16px;margin:12px 0}
.big{font-size:28px;font-weight:800}.g{color:#22c55e}.r{color:#ef4444}
a{color:#3b82f6}.cta{background:#0d1a12;border-color:#14532d}code{background:#0d1116;padding:2px 6px;border-radius:5px;font-size:12px}
</style></head><body>
<h1>🛡️ Exit Radar — Solana</h1>
<p class=sub>De los tokens que más se mueven ahora: ¿de cuáles <b>puedes salir de verdad</b> y cuáles son <b>trampa sin salida</b>? Medido con round-trip ejecutable real, no el precio cotizado. Gratis. Actualizado hace ${age} min.</p>
<div class=card><div class=big><span class=r>${trap.length}</span> trampas · <span class=g>${ok.length}</span> con salida</div>
<div class=sub>El 97% de los lanzamientos no tienen pool para vender. Esto te dice cuáles antes de entrar.</div></div>
<table><thead><tr><th>Token</th><th>Veredicto</th><th>Salida hasta</th><th>Mint</th></tr></thead><tbody>
${CACHE.rows.map(row).join("") || "<tr><td colspan=4>escaneando el firehose… recarga en 30s</td></tr>"}
</tbody></table>
<div class="card cta"><b>¿Eres un bot de trading?</b><br><span class=sub>Consulta la salida máxima de CUALQUIER token, o detecta un rug en progreso, pagando por llamada (USDC en Base, x402):</span><br><br>
<code>GET /escape-curve?mint=…</code> · <code>GET /liquidity-decay?mint=…</code><br>
<a href="/">ver los 13 oráculos →</a> · <a href="/.well-known/x402.json">discovery</a></div>
<p class=sub>ExitGuard · mide la salida ejecutable, no promete precio. No es consejo financiero.</p>
</body></html>`;
}
export { loop, page };
