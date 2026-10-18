// Prints the demo plan to the terminal: node scripts/demo-cli.mjs [ingredient_id]
import { readFileSync } from 'node:fs';
import { runPlan, explainRecommendation } from '../src/engine/index.mjs';
const data = JSON.parse(readFileSync(new URL('../data/demo/demo.json', import.meta.url)));
const plan = runPlan(data);
const id = process.argv[2];
const f = (x, d = 1) => Number(x).toFixed(d);
if (!id) {
  console.log(`As of ${plan.today} — all figures are estimates\n`);
  console.log('ingredient'.padEnd(26), 'onhand'.padStart(7), 'avg/day'.padStart(8), 'cover'.padStart(6), 'order'.padStart(8), ' urgency / supplier');
  for (const r of plan.recommendations) {
    const i = r.info;
    console.log(r.ingredient.name.padEnd(26), f(i.onHand).padStart(7), f(i.avgDailyDemand).padStart(8), (i.daysOfCover == null ? '-' : f(i.daysOfCover)).padStart(6), f(r.rec.orderQty).padStart(8), ' ', r.rec.urgency, r.supplier?.name ?? '');
  }
  console.log('\nAlerts:'); for (const a of plan.alerts) console.log(` [${a.severity}] ${a.title}`);
  console.log(`\nBasket: ${f(plan.basket.totalCost, 2)} incl. delivery; item WAPE ${f(plan.accuracy.overall.wape * 100)}%`);
} else {
  const e = explainRecommendation(plan, data, id);
  console.log(e.narrative, '\n'); e.steps.forEach((s) => console.log(` ${s.effect}  ${f(s.value, 2).padStart(8)}  ${s.label}`));
  console.log('\nWhat-if:'); e.sensitivity.rows.forEach((r) => console.log(` ${r.label.padEnd(32)} net ${(r.deltaNet >= 0 ? '+' : '') + f(r.deltaNet)}  order ${(r.deltaOrder >= 0 ? '+' : '') + f(r.deltaOrder)}`));
}
