// LA MOLEDORA: orquestador honesto que muele todos los carriles a la vez y solo
// cuenta lo que de verdad cae en la wallet. No inventa un número jamás. Corre un
// ciclo (o en bucle con --loop N). Su superioridad no es moler más fuerte: es
// MEDIR — deja de moler lo que no paga. Las máquinas no duermen; esta tampoco,
// pero tampoco se miente.
import { loadNodes, runSelfTests } from "./registry.js";

const PAY_TO = process.env.PAY_TO || "0xb7584544F07c5f172718E029Afd3F1C9a50A513C";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

async function usdcBalance(addr){
  try{
    const data = "0x70a08231" + addr.slice(2).toLowerCase().padStart(64,"0");
    const r = await fetch("https://mainnet.base.org",{ method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_call",params:[{to:USDC_BASE,data},"latest"]}) });
    const j = await r.json();
    return j.result ? Number(BigInt(j.result))/1e6 : null;
  }catch{ return null; }
}
async function marketSize(){
  try{
    const r = await fetch("https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources",
      { headers:{accept:"application/json"}, signal:AbortSignal.timeout(20000) });
    const d = await r.json();
    return Array.isArray(d.items) ? d.items.length : null;
  }catch{ return null; }
}

// Los carriles honestos y qué los bloquea HOY. Cada uno reporta si puede moler.
function lanes(env){
  return [
    { id:"x402-service", need:"URL pública (Render key o túnel fuera del sandbox)",
      ready:!!env.PUBLIC_URL, note:"7 nodos construidos y cobrando-capaz; falta exponer" },
    { id:"bittensor/depin", need:"wallet nueva y fondeada (clave en env, nunca en chat)",
      ready:!!env.PRIVATE_KEY, note:"el protocolo paga por proveer; corre 24/7" },
    { id:"retropgf", need:"repo público del bien público + postulación",
      ready:false, note:"detector de drainers ya vivo como artifact; postulable" },
  ];
}

async function cycle(env){
  const ts = new Date().toISOString();
  const { nodes } = await loadNodes();
  const health = runSelfTests(nodes);
  const [bal, mkt] = await Promise.all([ usdcBalance(PAY_TO), marketSize() ]);

  const L = lanes(env);
  const ready = L.filter(l=>l.ready);

  console.log("=".repeat(64));
  console.log(`  MOLEDORA · ${ts}`);
  console.log("=".repeat(64));
  console.log(`  motor:   ${nodes.length} nodos · autotests ${health.ok?"VERDE":"ROJO"}`);
  console.log(`  mercado: ${mkt==null?"?":mkt+" servicios x402 vivos (situational awareness)"}`);
  console.log("  carriles:");
  for(const l of L) console.log(`    ${l.ready?"▶ MOLIENDO":"■ bloqueado"}  ${l.id.padEnd(16)} ${l.ready?"":"→ falta: "+l.need}`);
  console.log("-".repeat(64));
  // EL LIBRO MAYOR HONESTO: rendimiento = saldo real en la cadena. Nada inventado.
  console.log(`  YIELD REAL (USDC on-chain, ${PAY_TO.slice(0,10)}…): ${bal==null?"(sin lectura)":"$"+bal.toFixed(4)}`);
  if(!ready.length){
    console.log("  veredicto: 0 carriles conectados → yield honesto = lo que haya en la wallet, ni un centavo más.");
    console.log("             la moledora NO inventa. Conecta un carril (arriba) y muele de verdad.");
  } else {
    console.log(`  veredicto: ${ready.length} carril(es) moliendo: ${ready.map(l=>l.id).join(", ")}`);
  }
  console.log("=".repeat(64));
  return { ts, nodes:nodes.length, health:health.ok, market:mkt, yield_usd:bal, ready:ready.map(l=>l.id) };
}

// --loop N  -> muele cada N segundos, sin dormir. Sin --loop, un ciclo.
const loopArg = process.argv.indexOf("--loop");
const env = { PUBLIC_URL:process.env.PUBLIC_URL, PRIVATE_KEY:process.env.PRIVATE_KEY };
if(loopArg>-1){
  const secs = Math.max(30, Number(process.argv[loopArg+1])||300);
  console.log(`moledora en bucle cada ${secs}s (Ctrl+C para parar)`);
  const tick = async ()=>{ try{ await cycle(env); }catch(e){ console.log("ciclo falló:",e.message); } };
  await tick(); setInterval(tick, secs*1000);
} else {
  await cycle(env);
}
