import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normInv, addDays, dayOfWeek, seasonalIndices, forecastItem, toDailySeries, simulateStock,
  recommendOrder, sensitivity, priceOffer, optimizeBasket, compareOffers, parseCsv, parseSalesCsv,
  runPlan, explainRecommendation, Z80,
} from '../src/engine/index.mjs';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} !≈ ${b}`);
const demo = () => JSON.parse(readFileSync(new URL('../data/demo/demo.json', import.meta.url)));

test('normInv matches known z-scores', () => {
  near(normInv(0.5), 0, 1e-9); near(normInv(0.95), 1.6448536, 1e-6); near(normInv(0.975), 1.959964, 1e-6); near(normInv(0.99), 2.326348, 1e-6);
  near(normInv(0.9), Z80, 1e-6);
  assert.throws(() => normInv(1));
});

test('date helpers are timezone-safe', () => {
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(dayOfWeek('2026-10-09'), 5); // Friday
});

function weeklySeries(weeks, pattern, level = 0) {
  const start = '2026-01-05'; // Monday
  const dates = []; const values = [];
  for (let i = 0; i < weeks * 7; i++) { const d = addDays(start, i); dates.push(d); values.push(pattern[dayOfWeek(d)] + level); }
  return { dates, values };
}

test('forecast recovers a noiseless weekly pattern', () => {
  const pattern = [20, 10, 12, 15, 18, 30, 35];
  const s = weeklySeries(10, pattern);
  const f = forecastItem(s, 14);
  for (const p of f.points) near(p.point, pattern[dayOfWeek(p.date)], 0.75);
  assert.equal(f.model.confidence, 'normal');
  assert.ok(f.points.every((p) => p.low <= p.point && p.point <= p.high));
});

test('seasonal indices average to 1 over open days and zero on closed days', () => {
  const s = weeklySeries(8, [0, 10, 12, 15, 18, 30, 35]);
  const idx = seasonalIndices(s.values, s.dates, [0]);
  assert.equal(idx[0], 0);
  near(idx.filter((_, d) => d !== 0).reduce((a, b) => a + b, 0) / 6, 1, 1e-9);
  const f = forecastItem(s, 7, { closedDows: [0] });
  assert.ok(f.points.filter((p) => dayOfWeek(p.date) === 0).every((p) => p.point === 0 && p.high === 0));
});

test('events, seasonal multipliers and unavailable dates are applied', () => {
  const s = weeklySeries(8, [20, 20, 20, 20, 20, 20, 20]);
  const day = addDays(s.dates.at(-1), 3);
  const base = forecastItem(s, 5);
  const adj = forecastItem(s, 5, { events: [{ date: day, extra_units: 50 }], seasonalMultiplier: () => 1.5, unavailable: new Set([addDays(day, 1)]) });
  near(adj.points[2].point - base.points[2].point * 1.5, 50, 1e-6);
  assert.equal(adj.points[3].point, 0);
});

test('short history is flagged low-confidence and never negative', () => {
  const f = forecastItem({ dates: ['2026-01-01', '2026-01-02', '2026-01-03'], values: [5, 0, 3] }, 3);
  assert.equal(f.model.confidence, 'very low');
  assert.ok(f.model.warnings.length > 0);
  assert.ok(f.points.every((p) => p.low >= 0 && p.point >= 0));
  assert.equal(forecastItem({ dates: [], values: [] }, 3).points.length, 0);
});

test('toDailySeries fills missing days with zero', () => {
  const s = toDailySeries([{ date: '2026-01-02', units: 4 }], '2026-01-01', '2026-01-03');
  assert.deepEqual(s.values, [0, 4, 0]);
});

test('simulateStock uses FEFO, wastes expired stock and records shortages', () => {
  const r = simulateStock({
    startDate: '2026-10-01',
    lots: [{ id: 'old', qty: 10, expiry: '2026-10-02' }, { id: 'new', qty: 10, expiry: '2026-10-10' }],
    demand: [4, 4, 4, 4, 4, 4],
  });
  // day0: 4 from old; day1: 4 from old; day2: old has 2 left → expires, wasted 2
  assert.equal(r.wasted.length, 1);
  assert.equal(r.wasted[0].lotId, 'old'); near(r.wasted[0].qty, 2); assert.equal(r.wasted[0].date, '2026-10-03');
  // remaining demand 4*4=16 vs 10 in 'new' → short 6 by the end, first short on day index 4
  near(r.shortTotal, 6); assert.equal(r.firstShortDate, '2026-10-05');
});

test('simulateStock handles inbound arrivals', () => {
  const r = simulateStock({ startDate: '2026-10-01', lots: [{ id: 'a', qty: 3, expiry: '2026-10-30' }], inbound: [{ id: 'po', qty: 10, arrival: '2026-10-03', expiry: '2026-10-20' }], demand: [2, 2, 2, 2] });
  assert.equal(r.shortTotal, 1); // day1 short (3-2=1 → need 2 → short 1), day2 uses inbound
  assert.equal(r.firstShortDate, '2026-10-02');
});

const ING = { id: 'x', name: 'X', unit: 'kg', shelf_life_days: 30, order_cycle_days: 3, min_safety_days: 0, max_days_cover: 30 };
const flat = (m, sd, n = 28) => ({ mean: Array(n).fill(m), sd: Array(n).fill(sd) });
const base = (over = {}) => ({ ingredient: ING, demand: flat(10, 2), lots: [{ id: 'l', qty: 20, expiry: '2027-01-01' }], inbound: [], offer: { pack_size: 5, moq_units: 0, lead_time_days: 2 }, settings: { serviceLevel: 0.95 }, today: '2026-10-01', ...over });

test('recommendOrder: hand-checkable result', () => {
  const r = recommendOrder(base());
  // window = 2 lead + 3 review = 5 days → demand 50; sd over window = 2*sqrt(5); SS = 1.645*4.472
  near(r.demandWindow, 50);
  near(r.safetyStock, normInv(0.95) * 2 * Math.sqrt(5), 1e-9);
  near(r.netRequirement, 50 + r.safetyStock - 20, 1e-9);
  assert.equal(r.orderQty % 5, 0);
  assert.ok(r.orderQty >= r.netRequirement && r.orderQty < r.netRequirement + 5);
  assert.equal(r.urgency, 'order_today');
});

test('recommendOrder: higher service level / lead time / demand never lowers the quantity; more stock never raises it', () => {
  const q = (o) => recommendOrder(base(o)).netRequirement;
  const b = q({});
  assert.ok(q({ settings: { serviceLevel: 0.99 } }) > b);
  assert.ok(q({ offer: { pack_size: 5, lead_time_days: 3 } }) > b);
  assert.ok(q({ demand: flat(11, 2.2) }) > b);
  assert.ok(q({ lots: [{ id: 'l', qty: 30, expiry: '2027-01-01' }] }) < b);
});

test('recommendOrder: zero order when stock is ample', () => {
  const r = recommendOrder(base({ lots: [{ id: 'l', qty: 200, expiry: '2027-01-01' }] }));
  assert.equal(r.orderQty, 0); assert.equal(r.urgency, 'ok');
});

test('recommendOrder: MOQ raises the quantity and is flagged', () => {
  const r = recommendOrder(base({ offer: { pack_size: 5, moq_units: 100, lead_time_days: 2 } }));
  assert.equal(r.orderQty, 100); assert.equal(r.moqDriven, true); assert.ok(r.flags.some((f) => /minimum/i.test(f)));
});

test('recommendOrder: stock that expires before use is not counted as usable', () => {
  const lots = [{ id: 'l', qty: 20, expiry: '2026-10-01' }]; // dies after today
  const r = recommendOrder(base({ lots, ingredient: { ...ING, shelf_life_days: 30 } }));
  assert.ok(r.expiringBeforeUse > 0);
  assert.ok(r.usableStock < 20);
});

test('recommendOrder: shelf life caps oversized orders', () => {
  const r = recommendOrder(base({ ingredient: { ...ING, shelf_life_days: 3, max_days_cover: 3, order_cycle_days: 14 }, lots: [{ id: 'l', qty: 0, expiry: '2027-01-01' }] }));
  assert.equal(r.limitedByShelfLife, true);
  assert.ok(r.orderQty <= 10 * 3 + 5 + r.safetyStock + 5);
});

test('recommendOrder: expedite when stock-out precedes the delivery', () => {
  const r = recommendOrder(base({ lots: [{ id: 'l', qty: 5, expiry: '2027-01-01' }] }));
  assert.equal(r.daysToShortage, 0); assert.equal(r.urgency, 'expedite');
});

test('sensitivity reports signed deltas against the base case', () => {
  const s = sensitivity(base());
  const byKey = Object.fromEntries(s.rows.map((r) => [r.key, r]));
  assert.ok(byKey['demand+10'].deltaNet > 0 && byKey['demand-10'].deltaNet < 0);
  assert.ok(byKey['stock+20'].deltaNet < 0 && byKey['stock-20'].deltaNet > 0);
  assert.ok(byKey['sl99'].deltaNet > 0 && byKey['sl90'].deltaNet < 0);
  assert.ok(byKey['lead+1'].deltaNet > 0);
});

test('priceOffer rounds to packs and honours MOQ', () => {
  const p = priceOffer({ pack_size: 5, pack_price: 20, moq_units: 12 }, 7);
  assert.equal(p.packs, 3); assert.equal(p.qty, 15); assert.equal(p.goods, 60); assert.equal(p.moqDriven, true); near(p.excess, 8);
});

test('optimizeBasket consolidates to avoid a delivery fee when that is cheaper', () => {
  const suppliers = [
    { id: 'A', name: 'A', delivery_fee: 30, free_delivery_over: 1000, min_order_value: 0 },
    { id: 'B', name: 'B', delivery_fee: 30, free_delivery_over: 1000, min_order_value: 0 },
  ];
  const opt = (sup, goods) => ({ offer: { supplier_id: sup }, qty: 1, goods, feasible: true });
  const res = optimizeBasket([
    { ingredientId: 'i1', options: [opt('A', 100), opt('B', 100)] },
    { ingredientId: 'i2', options: [opt('A', 105), opt('B', 100)] },
  ], suppliers);
  // i1 starts at A (tie → first), i2 starts at B (cheaper): two fees. Moving i1 to B saves a fee.
  assert.deepEqual(new Set(res.lines.map((l) => l.offer.supplier_id)), new Set(['B']));
  assert.equal(res.totalCost, 230);
});

test('optimizeBasket avoids infeasible (too-slow) offers when a feasible one exists', () => {
  const suppliers = [{ id: 'A', name: 'A', delivery_fee: 0, min_order_value: 0 }, { id: 'B', name: 'B', delivery_fee: 0, min_order_value: 0 }];
  const res = optimizeBasket([{ ingredientId: 'i', options: [{ offer: { supplier_id: 'A' }, goods: 10, feasible: false }, { offer: { supplier_id: 'B' }, goods: 20, feasible: true }] }], suppliers);
  assert.equal(res.lines[0].offer.supplier_id, 'B');
});

test('compareOffers ranks feasible offers first and charges delivery below the free threshold', () => {
  const rows = compareOffers({
    ingredient: ING, qtyNeeded: 10, daysToShortage: 1,
    suppliers: [{ id: 'A', name: 'A', delivery_fee: 10, free_delivery_over: 50 }, { id: 'B', name: 'B', delivery_fee: 5, free_delivery_over: 500 }],
    offers: [
      { supplier_id: 'A', ingredient_id: 'x', pack_size: 5, pack_price: 10, lead_time_days: 2 },
      { supplier_id: 'B', ingredient_id: 'x', pack_size: 5, pack_price: 12, lead_time_days: 1 },
    ],
  });
  assert.equal(rows[0].supplier.id, 'B'); assert.equal(rows[0].feasible, true); assert.equal(rows[0].landed, 29);
  assert.equal(rows[1].feasible, false); assert.equal(rows[1].landed, 30);
});

test('CSV parser handles quotes, CRLF and BOM', () => {
  const t = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n');
  assert.deepEqual(t, [['a', 'b'], ['x, y', 'he said "hi"']]);
});

test('sales CSV import validates dates, units and item names', () => {
  const menu = [{ id: 'burger', name: 'Beef Burger' }];
  const ok = parseSalesCsv('date,item,units\n2026-10-01,Beef Burger,40\n2026-10-02,burger,12\n', menu);
  assert.equal(ok.errors.length, 0); assert.equal(ok.rows.length, 2);
  const bad = parseSalesCsv('date,item,units\n10/01/2026,Beef Burger,40\n2026-10-02,Beef Burger,-3\n2026-10-03,Beef Burger,1.5\n2026-10-04,Mystery,2\n', menu);
  assert.equal(bad.errors.length, 3); assert.ok(bad.warnings.some((w) => /unknown/i.test(w)));
  assert.ok(parseSalesCsv('foo,bar\n1,2\n', menu).errors.length > 0);
  const dup = parseSalesCsv('date,item,units\n2026-10-01,burger,1\n2026-10-01,burger,9\n', menu);
  assert.equal(dup.rows[0].units, 9); assert.ok(dup.warnings.some((w) => /duplicate/i.test(w)));
});

test('demo plan: coherent end to end', () => {
  const data = demo();
  const plan = runPlan(data);
  assert.equal(plan.recommendations.length, data.ingredients.length);
  for (const r of plan.recommendations) {
    assert.ok(r.rec.orderQty >= 0 && Number.isFinite(r.rec.orderQty));
    if (r.offer && r.rec.orderQty > 0) assert.equal(r.rec.orderQty % r.offer.pack_size < 1e-6 || Math.abs((r.rec.orderQty % r.offer.pack_size) - r.offer.pack_size) < 1e-6, true);
    const sum = r.rec.steps.find((s) => s.key === 'net');
    assert.ok(Number.isFinite(sum.value));
  }
  assert.ok(plan.alerts.some((a) => a.type === 'waste'), 'demo should show a waste alert');
  assert.ok(plan.alerts.some((a) => a.type === 'shortage'), 'demo should show a shortage alert');
  assert.ok(plan.basket.totalCost > 0);
  // Accuracy is measured against held-out weeks and must beat nothing worse than a sane bound
  assert.ok(plan.accuracy.overall.wape > 0 && plan.accuracy.overall.wape < 0.5);
  // Every supplier fee/min-order is reflected
  assert.equal(plan.basket.bySupplier.length, new Set(plan.basket.lines.map((l) => l.offer.supplier_id)).size);
});

test('demo plan is deterministic', () => {
  const a = runPlan(demo()); const b = runPlan(demo());
  assert.deepEqual(a.recommendations.map((r) => r.rec.orderQty), b.recommendations.map((r) => r.rec.orderQty));
});

test('backtest never peeks at the future', () => {
  const data = demo();
  const p1 = runPlan(data);
  // Corrupt the final 7 days: accuracy windows before that must be unaffected by training data from those days.
  const last = addDays(data.meta.asOf, -1);
  const corrupt = { ...data, sales: data.sales.map((s) => (s.date > addDays(last, -7) ? { ...s, units: s.units * 5 } : s)) };
  const p2 = runPlan(corrupt);
  const pairsBefore = (p) => p.accuracy.byItem.chicken.pairs.filter((x) => x.date <= addDays(last, -7)).map((x) => x.f.toFixed(6));
  assert.deepEqual(pairsBefore(p1), pairsBefore(p2));
});

test('explanations expose steps, contributions, assumptions and what-ifs', () => {
  const data = demo(); const plan = runPlan(data);
  const e = explainRecommendation(plan, data, 'chicken_thigh');
  assert.ok(e.steps.length >= 5); assert.ok(e.contributions[0].name); assert.ok(e.assumptions.length >= 5);
  assert.ok(/estimate/i.test(e.narrative)); assert.ok(e.sensitivity.rows.length >= 6);
  assert.ok(e.events.length > 0, 'catering event should be listed for chicken');
  assert.throws(() => explainRecommendation(plan, data, 'nope'));
});

test('safety stock differs with correlation assumption', () => {
  const data = demo();
  const a = runPlan(data, { demandCorrelation: 0 }).recommendations.find((r) => r.ingredientId === 'mushrooms').rec.safetyStock;
  const b = runPlan(data, { demandCorrelation: 1 }).recommendations.find((r) => r.ingredientId === 'mushrooms').rec.safetyStock;
  assert.ok(b > a);
});
