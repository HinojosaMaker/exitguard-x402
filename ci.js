// ARNES DE CI: monitorea y prueba todos los nodos. Sin red (solo autotests
// unitarios puros). Exit code != 0 si algo falla -> encadenable en cualquier
// pipeline (pre-commit, GitHub Actions, watcher). "node ci.js".
import { loadNodes, runSelfTests } from "./registry.js";

const { nodes, errors } = await loadNodes();
if (errors.length) {
  console.log("NODOS QUE NO CARGAN:");
  for (const e of errors) console.log(`  ✗ ${e.file}: ${e.error}`);
}

const { ok, results } = runSelfTests(nodes);
console.log("=".repeat(60));
console.log(`  CI · ${nodes.length} nodos cargados`);
console.log("=".repeat(60));
let totalChecks = 0, passed = 0;
for (const r of results) {
  const mark = r.ok === null ? "–" : r.ok ? "✓" : "✗";
  console.log(`  ${mark} ${r.id}${r.error ? "  ERROR: " + r.error : ""}`);
  for (const c of r.checks) {
    totalChecks++; if (c.pass) passed++;
    if (!c.pass) console.log(`      ✗ ${c.name}`);
  }
}
console.log("-".repeat(60));
console.log(`  ${passed}/${totalChecks} checks verdes · ${errors.length} nodos rotos`);
console.log("=".repeat(60));

const green = ok && errors.length === 0;
console.log(green ? "CI VERDE" : "CI ROJO");
process.exit(green ? 0 : 1);
