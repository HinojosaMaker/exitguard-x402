// NODO AUTOEJECUTABLE: detector de drainers (AST de calldata).
// Descompone un calldata en arbol de llamadas y marca cualquier primitiva de
// movimiento de valor a cualquier nivel, INCLUSO dentro de multicall/execute.
// Logica pura portada de layer0-depin/src/sentinel/calldata.rs.

const DANGEROUS = {
  "a9059cbb": "transfer(address,uint256)",
  "23b872dd": "transferFrom(address,address,uint256)",
  "095ea7b3": "approve(address,uint256)",
  "39509351": "increaseAllowance(address,uint256)",
  "a22cb465": "setApprovalForAll(address,bool)",
  "d505accf": "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
  "42842e0e": "safeTransferFrom(address,address,uint256)",
  "39591851": "upgradeTo(address)",
};
const WRAPPERS = {                 // selector -> [nombre, offset del header bytes[]]
  "ac9650d8": ["multicall(bytes[])", 0],
  "5ae401dc": ["multicall(uint256,bytes[])", 32],
  "1f0df1bd": ["multicall(bytes32,bytes[])", 32],
  "3d93564c": ["execute(bytes,bytes[])", 32],
  "24856bc3": ["execute(bytes,bytes[],uint256)", 32],
};
const MAX_DEPTH = 6;

const toBytes = s => {
  s = String(s).trim().replace(/^0x/i, "");
  if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) return null;
  return Buffer.from(s, "hex");
};
function wordUsize(buf, at) {
  if (at < 0 || at + 32 > buf.length) return null;
  for (let i = at; i < at + 24; i++) if (buf[i] !== 0) return null;
  let n = 0n; for (let i = at + 24; i < at + 32; i++) n = (n << 8n) | BigInt(buf[i]);
  return Number(n);
}
function readBytesArray(args, headerOff, findings) {
  const out = [];
  const arrayPos = wordUsize(args, headerOff);
  if (arrayPos === null) { findings.push({ kind: "malformed", reason: "offset de bytes[] invalido" }); return out; }
  const n = wordUsize(args, arrayPos);
  if (n === null) return out;
  if (n > 256) { findings.push({ kind: "malformed", reason: "bytes[] con demasiados elementos" }); return out; }
  const base = arrayPos + 32;
  for (let i = 0; i < n; i++) {
    const elOff = wordUsize(args, base + i * 32);
    if (elOff === null) { findings.push({ kind: "malformed", reason: "offset de elemento fuera de rango" }); break; }
    const elPos = base + elOff;
    const elemLen = wordUsize(args, elPos);
    if (elemLen === null) { findings.push({ kind: "malformed", reason: "longitud de elemento fuera de rango" }); continue; }
    const start = elPos + 32;
    if (start + elemLen <= args.length) out.push(args.subarray(start, start + elemLen));
    else findings.push({ kind: "malformed", reason: "datos de elemento truncados" });
  }
  return out;
}
function addresses(args) {
  const out = [];
  for (let i = 0; i + 32 <= args.length && out.length < 16; i += 32) {
    let hiZero = true; for (let j = i; j < i + 12; j++) if (args[j] !== 0) { hiZero = false; break; }
    let loNZ = false; for (let j = i + 12; j < i + 32; j++) if (args[j] !== 0) { loNZ = true; break; }
    if (hiZero && loNZ) out.push("0x" + args.subarray(i + 12, i + 32).toString("hex"));
  }
  return out;
}
function decode(data, depth, findings) {
  if (depth > MAX_DEPTH) { findings.push({ kind: "too_deep", limit: MAX_DEPTH }); return null; }
  if (data.length < 4) return null;
  const sel = data.subarray(0, 4).toString("hex");
  const args = data.subarray(4);
  const wrap = WRAPPERS[sel];
  const children = [];
  if (wrap) for (const sub of readBytesArray(args, wrap[1], findings)) {
    const c = decode(sub, depth + 1, findings);
    if (c) children.push(c);
  }
  return {
    selector: "0x" + sel, known_as: DANGEROUS[sel] || (wrap && wrap[0]) || null,
    is_dangerous: !!DANGEROUS[sel], is_wrapper: !!wrap,
    addresses: addresses(args), children, depth,
  };
}
function walk(node, allowed, strict, findings) {
  const sel = node.selector.slice(2);
  if (node.is_dangerous) {
    if (!allowed.has(sel)) findings.push({ kind: "dangerous_call", selector: node.selector, name: node.known_as, depth: node.depth });
  } else if (!node.is_wrapper && strict) {
    if (!allowed.has(sel)) findings.push({ kind: "unknown_selector", selector: node.selector, depth: node.depth });
  }
  for (const c of node.children) walk(c, allowed, strict, findings);
}

// funcion pura exportada
export function audit(hexStr, allowedList, strict) {
  const data = toBytes(hexStr);
  if (!data) return { error: "calldata invalido: se espera hex (0x...)" };
  const allowed = new Set((allowedList || []).map(s => String(s).replace(/^0x/i, "").toLowerCase()));
  const findings = [];
  const tree = decode(data, 0, findings);
  if (tree) walk(tree, allowed, !!strict, findings);
  else if (findings.length === 0) findings.push({ kind: "malformed", reason: "calldata mas corto que un selector" });
  return { safe: findings.length === 0, findings, tree };
}

export default {
  id: "calldata-audit",
  price: "$0.02",
  params: ["calldata", "allow", "strict"],
  description: "Audita un calldata de router antes de firmarlo: detecta transfer/approve/permit ocultos, incluso dentro de multicall/execute. Detector de drainers.",
  pure: true,
  handle(q) {
    const allow = String(q.allow || "").split(",").map(s => s.trim()).filter(Boolean);
    const strict = q.strict === "1" || q.strict === "true";
    const r = audit(String(q.calldata || q.data || ""), allow, strict);
    if (r.error) return { error: r.error };
    return {
      safe: r.safe, verdict: r.safe ? "FIRMABLE" : "NO_FIRMAR",
      findings: r.findings, tree: r.tree,
      meaning: r.safe
        ? "No se detecto ninguna primitiva de movimiento de valor no permitida en ningun nivel."
        : "El calldata mueve o esconde una llamada que mueve valor (posible drainer): NO firmar sin revisar findings.",
      method: "AST estatico del calldata; recorre multicall/execute; no ejecuta ni simula",
    };
  },
  // AUTOTEST: el modelo de amenaza completo, incluida la ocultacion en multicall.
  selfTest() {
    const pad = h => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
    const w = n => BigInt(n).toString(16).padStart(64, "0");
    const ATT = "0x00000000000000000000000000000000deadbeef";
    const transfer = "a9059cbb" + pad(ATT) + w(1000);
    const swap = "414bf389" + w(1) + w(2) + pad(ATT) + w(500);
    // multicall(bytes[]) envolviendo [swap, transfer]
    const enc = calls => {
      let s = w(0x20) + w(calls.length);
      const heads = []; let dyn = ""; let cur = calls.length * 32;
      for (const c of calls) {
        heads.push(w(cur));
        const padded = c + "0".repeat((64 - (c.length % 64)) % 64);
        dyn += w(c.length / 2) + padded; cur += 32 + padded.length / 2;
      }
      return "ac9650d8" + s + heads.join("") + dyn;
    };
    const multi = enc([swap, transfer]);
    const A = ["414bf389"];
    const checks = [
      { name: "transfer directo → NO_FIRMAR", pass: audit(transfer, A, false).safe === false },
      { name: "swap legitimo → FIRMABLE", pass: audit(swap, A, false).safe === true },
      { name: "transfer oculto en multicall (depth 1) → NO_FIRMAR", pass: audit(multi, A, false).safe === false },
      { name: "hex invalido → error", pass: !!audit("xyz", A, false).error },
    ];
    return { ok: checks.every(c => c.pass), checks };
  },
};
