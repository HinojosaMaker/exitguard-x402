// Vigilante de cadena: escucha la wallet de cobro en Base y REACCIONA en el
// instante en que entra un pago USDC. Es "lo que recibe cuando algo entra en la
// blockchain": consulta el saldo on-chain cada pocos segundos y, en cuanto sube,
// registra el pago (monto, timestamp) y lo deja listo para disparar lo que quieras
// (notificar, entregar el resultado, contabilizar). No mueve fondos: solo escucha.
import fs from "node:fs";

const PAY_TO = process.env.PAY_TO || "0xb7584544F07c5f172718E029Afd3F1C9a50A513C";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RPC = process.env.BASE_RPC || "https://mainnet.base.org";
const CADA_MS = Number(process.env.WATCH_MS || 5000);
const LEDGER = "C:/Users/Admin/agent-service/pagos_recibidos.jsonl";

async function saldo(addr) {
  const data = "0x70a08231" + addr.slice(2).toLowerCase().padStart(64, "0");
  const r = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call",
      params: [{ to: USDC, data }, "latest"] }),
  });
  const j = await r.json();
  return j.result ? Number(BigInt(j.result)) / 1e6 : null;
}

async function bloque() {
  try {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
    return Number(BigInt((await r.json()).result || "0x0"));
  } catch { return null; }
}

function registrar(monto, delta, blk) {
  const fila = { ts: new Date().toISOString(), wallet: PAY_TO, network: "base",
    saldo_usdc: monto, entrada_usdc: +delta.toFixed(6), block: blk };
  fs.appendFileSync(LEDGER, JSON.stringify(fila) + "\n");
  // aquí se dispararía lo que quieras al cobrar (webhook, entrega, alerta)
  console.log(`\n>>> PAGO RECIBIDO  +${delta.toFixed(6)} USDC  (saldo ${monto})  block ${blk}`);
  console.log(`    basescan.org/address/${PAY_TO}\n`);
}

async function main() {
  let prev = await saldo(PAY_TO);
  const blk = await bloque();
  console.log(`[watcher] escuchando ${PAY_TO} en Base (USDC). saldo inicial ${prev}, block ${blk}.`);
  console.log(`[watcher] en cuanto entre un pago, lo verás aquí y en ${LEDGER} al instante.`);
  setInterval(async () => {
    const s = await saldo(PAY_TO);
    if (s == null) return;
    if (prev != null && s > prev + 1e-9) registrar(s, s - prev, await bloque());
    prev = s;
  }, CADA_MS);
}
main();
