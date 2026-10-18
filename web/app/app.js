import { runPlan, explainRecommendation, parseSalesCsv, addDays, DOW_NAMES, dayOfWeek, compareOffers } from '/engine/index.mjs';

const original = await (await fetch('/data/demo.json')).json();
let data = structuredClone(original);
let plan = runPlan(data);
let sel = { ingredient: null, item: 'all', compare: null };
let importState = null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (x, d = 1) => (x == null || !Number.isFinite(x) ? '–' : Number(x).toFixed(d));
const money = (x) => '$' + Number(x).toFixed(2);
const pct = (x) => (x == null ? '–' : (x * 100).toFixed(1) + '%');
const ingName = (id) => data.ingredients.find((i) => i.id === id)?.name ?? id;
const itemName = (id) => data.menuItems.find((i) => i.id === id)?.name ?? id;
const recompute = () => { plan = runPlan(data); render(); };

const NAV = [['overview', 'Overview'], ['purchase', 'Purchase orders'], ['alerts', 'Alerts'], ['inventory', 'Inventory'], ['forecast', 'Demand forecast'], ['menu', 'Recipes & menu'], ['suppliers', 'Suppliers'], ['import', 'Sales import'], ['accuracy', 'Forecast accuracy'], ['settings', 'Assumptions']];

// ---------- charts
function lineChart({ series, band, w = 640, h = 200, yLabel = '', marks = [] }) {
  const n = series.length; if (!n) return '';
  const pad = { l: 40, r: 10, t: 10, b: 24 };
  const ymax = Math.max(1, ...series.map((p) => Math.max(p.y, p.hi ?? 0))) * 1.08;
  const X = (i) => pad.l + (i / Math.max(n - 1, 1)) * (w - pad.l - pad.r);
  const Y = (v) => h - pad.b - (v / ymax) * (h - pad.t - pad.b);
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = band ? `M${series.map((p, i) => `${X(i).toFixed(1)},${Y(p.hi).toFixed(1)}`).join('L')}L${series.map((p, i) => `${X(n - 1 - i).toFixed(1)},${Y(series[n - 1 - i].lo).toFixed(1)}`).join('L')}Z` : '';
  const ticks = [0, 0.5, 1].map((t) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(ymax * t / 1.08)}" y2="${Y(ymax * t / 1.08)}" stroke="var(--line)"/><text x="${pad.l - 5}" y="${Y(ymax * t / 1.08) + 4}" text-anchor="end">${f(ymax * t / 1.08, ymax > 20 ? 0 : 1)}</text>`).join('');
  const xl = series.map((p, i) => (i % Math.ceil(n / 7) === 0 ? `<text x="${X(i)}" y="${h - 6}" text-anchor="middle">${esc(p.x)}</text>` : '')).join('');
  const mk = marks.map((m) => `<line x1="${X(m.i)}" x2="${X(m.i)}" y1="${pad.t}" y2="${h - pad.b}" stroke="var(--orange)" stroke-dasharray="4 3"/><text x="${X(m.i) + 4}" y="${pad.t + 10}" style="fill:var(--orange)">${esc(m.label)}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(yLabel)}">${ticks}${band ? `<path d="${area}" fill="var(--forest)" opacity=".15"/>` : ''}<path d="${line}" fill="none" stroke="var(--forest)" stroke-width="2.2"/>${mk}${xl}</svg>`;
}

// ---------- shared bits
const sevBadge = (s) => `<span class="badge ${s === 'critical' ? 'b-crit' : s === 'warning' ? 'b-warn' : 'b-info'}">${s === 'info' ? 'watch' : s}</span>`;
function orderPill(r) {
  const u = r.ingredient.unit;
  if (r.rec.urgency === 'expedite') return `<span class="order-pill crit">Expedite ${f(r.rec.orderQty)} ${u}</span>`;
  if (r.rec.orderQty > 0) return `<span class="order-pill">Order ${f(r.rec.orderQty)} ${u}</span>`;
  return `<span class="order-pill none">No order</span>`;
}
const status = (r) => {
  const a = plan.alerts.filter((x) => x.ingredientId === r.ingredientId);
  if (a.some((x) => x.severity === 'critical')) return '<span class="badge b-crit">Critical</span>';
  if (a.some((x) => x.severity === 'warning')) return '<span class="badge b-warn">Attention</span>';
  return '<span class="badge b-ok">OK</span>';
};
const head = (t, s) => `<h1>${t}</h1><p class="sub">${s}</p>`;

// ---------- views
const views = {
  overview() {
    const toOrder = plan.recommendations.filter((r) => r.rec.orderQty > 0);
    const crit = plan.alerts.filter((a) => a.severity === 'critical');
    const warnW = plan.alerts.filter((a) => a.type === 'waste' && a.severity !== 'info');
    const wasteVal = warnW.reduce((s, a) => s + (a.metrics.wasteValue || 0), 0);
    const total = plan.today && Array.from({ length: 28 }, (_, i) => ({ x: addDays(plan.today, i).slice(5), y: data.menuItems.reduce((s, m) => s + (plan.forecasts[m.id].points[i]?.point || 0), 0), lo: data.menuItems.reduce((s, m) => s + (plan.forecasts[m.id].points[i]?.low || 0), 0), hi: data.menuItems.reduce((s, m) => s + (plan.forecasts[m.id].points[i]?.high || 0), 0) }));
    return `${head('Good morning', `Plan for ${plan.today} · ${esc(data.meta.location)}`)}
    <div class="kpis">
      <div class="kpi ${toOrder.length ? 'warn' : ''}"><b>${toOrder.length}</b><span>ingredients to order today</span></div>
      <div class="kpi ${crit.length ? 'crit' : ''}"><b>${crit.length}</b><span>critical alerts</span></div>
      <div class="kpi ${wasteVal ? 'warn' : ''}"><b>${money(wasteVal)}</b><span>stock projected to expire unused (catalogue cost)</span></div>
      <div class="kpi"><b>${money(plan.basket.totalCost)}</b><span>recommended basket incl. delivery</span></div>
      <div class="kpi"><b>${pct(plan.accuracy.overall.wape)}</b><span>dish-level forecast error (WAPE), last ${plan.settings.backtestWeeks} weeks</span></div>
    </div>
    <h2>Do this first</h2>
    ${plan.alerts.filter((a) => a.severity !== 'info').slice(0, 5).map(alertHtml).join('') || '<p>Nothing urgent.</p>'}
    <h2>Total dish demand, next 28 days <span class="small">(estimate with 80% range)</span></h2>
    <div class="card">${lineChart({ series: total, band: true, yLabel: 'Total portions per day' })}<div class="legend"><span>Line: central estimate · Shaded: 80% range of past errors</span></div></div>`;
  },

  purchase() {
    const rows = plan.recommendations.slice().sort((a, b) => (b.rec.urgency === 'expedite') - (a.rec.urgency === 'expedite') || (b.rec.orderQty > 0) - (a.rec.orderQty > 0));
    return `${head('Purchase order recommendations', 'Click a row to see exactly how the quantity was calculated.')}
    <div class="card"><table><thead><tr><th>Ingredient</th><th>Recommendation</th><th class="r">On hand</th><th class="r">Days cover</th><th>Supplier</th><th class="r">Est. cost</th><th>Status</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="click" data-act="explain" data-id="${r.ingredientId}" tabindex="0"><td><b>${esc(r.ingredient.name)}</b></td><td>${orderPill(r)}${r.rec.packs ? `<div class="small">${r.rec.packs} × ${r.offer.pack_size} ${r.ingredient.unit}${r.rec.moqDriven ? ' · minimum order' : ''}</div>` : ''}</td><td class="r num">${f(r.info.onHand)} ${r.ingredient.unit}</td><td class="r num">${f(r.info.daysOfCover)}</td><td>${r.rec.orderQty > 0 ? `${esc(r.supplier.name)}<div class="small">${r.rec.leadDays}-day lead</div>` : '–'}</td><td class="r num">${r.cost ? money(r.cost) : '–'}</td><td>${status(r)}</td></tr>`).join('')}
    </tbody></table></div>
    <h2>Orders by supplier</h2>
    <div class="two">${plan.basket.bySupplier.map((s) => `<div class="card"><b>${esc(s.supplier.name)}</b>
      <table><tbody>${plan.basket.lines.filter((l) => l.offer.supplier_id === s.supplier.id).map((l) => `<tr><td>${esc(ingName(l.ingredientId))}</td><td class="r num">${l.rec.packs} × ${l.offer.pack_size}</td><td class="r num">${money(l.goods)}</td></tr>`).join('')}
      <tr><td colspan="2">Goods</td><td class="r num">${money(s.goods)}</td></tr><tr><td colspan="2">Delivery ${s.fee === 0 ? '(free over ' + money(s.supplier.free_delivery_over) + ')' : ''}</td><td class="r num">${money(s.fee)}</td></tr><tr><th colspan="2">Total</th><td class="r num"><b>${money(s.goods + s.fee)}</b></td></tr></tbody></table>
      ${s.belowMinimum ? `<div class="msg w">Below this supplier's ${money(s.supplier.min_order_value)} minimum order by ${money(s.minShortfall)}; add items or ask for an exception.</div>` : ''}</div>`).join('')}</div>
    <div id="explain-panel">${sel.ingredient ? explainHtml(sel.ingredient) : ''}</div>`;
  },

  alerts() {
    return `${head('Waste and shortage alerts', 'Critical = stock-out likely before any delivery can arrive. Attention = act today. Watch = possible if demand differs from the central estimate.')}
    ${plan.alerts.length ? plan.alerts.map(alertHtml).join('') : '<p>No alerts.</p>'}`;
  },

  inventory() {
    return `${head('Ingredient inventory', 'Enter today\'s counts to update every forecast and recommendation. Expiry uses the last usable day.')}
    <div class="card"><table><thead><tr><th>Ingredient</th><th>Lots (use-by)</th><th class="r">Total</th><th class="r">Forecast use/day</th><th class="r">Days cover</th><th>Waste risk</th></tr></thead><tbody>
    ${plan.perIngredient.map((i) => {
      const w = i.sim.mean.wasteQty, wl = i.sim.low.wasteQty;
      const risk = w * i.unitCost >= plan.settings.wasteValueAlert ? `<span class="badge b-crit">${f(w)} ${i.ingredient.unit} may expire</span>` : wl * i.unitCost >= plan.settings.wasteValueAlert ? '<span class="badge b-warn">if demand is low</span>' : '<span class="badge b-ok">low</span>';
      return `<tr><td><b>${esc(i.ingredient.name)}</b><div class="small">${esc(i.ingredient.category)} · shelf life ${i.ingredient.shelf_life_days}d</div></td>
      <td>${data.stock.filter((s) => s.ingredient_id === i.ingredient.id).map((s) => `<div class="row" style="margin:2px 0"><input class="sm" type="number" min="0" step="0.1" value="${s.qty}" data-act="stock" data-lot="${esc(s.lot_id)}" aria-label="${esc(s.lot_id)} quantity"> ${i.ingredient.unit} <span class="small">${esc(s.lot_id)} · ${s.expiry_date}</span></div>`).join('') || '<span class="small">none</span>'}</td>
      <td class="r num">${f(i.onHand)} ${i.ingredient.unit}</td><td class="r num">${f(i.avgDailyDemand)}</td><td class="r num">${f(i.daysOfCover)}</td><td>${risk}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  },

  forecast() {
    const id = sel.item;
    const items = id === 'all' ? data.menuItems : data.menuItems.filter((m) => m.id === id);
    const pts = (i) => items.reduce((s, m) => s + (plan.forecasts[m.id].points[i]?.point || 0), 0);
    const series = Array.from({ length: 28 }, (_, i) => ({ x: addDays(plan.today, i).slice(5), y: pts(i), lo: items.reduce((s, m) => s + (plan.forecasts[m.id].points[i]?.low || 0), 0), hi: items.reduce((s, m) => s + (plan.forecasts[m.id].points[i]?.high || 0), 0) }));
    const marks = data.events.filter((e) => id === 'all' || e.menu_item_id === id).map((e) => ({ i: series.findIndex((p) => p.x === e.date.slice(5)), label: 'event' })).filter((m) => m.i >= 0).slice(0, 1);
    const models = items.map((m) => ({ m, model: plan.forecasts[m.id].model }));
    const one = items.length === 1 ? models[0].model : null;
    return `${head('Demand forecast', 'Estimated portions per day. These are statistical estimates, not guarantees.')}
    <div class="row"><label>Dish<select data-act="item"><option value="all">All dishes</option>${data.menuItems.map((m) => `<option value="${m.id}" ${m.id === id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label></div>
    <div class="card">${lineChart({ series, band: true, marks, yLabel: 'Portions per day' })}<div class="legend"><span>Line: central estimate</span><span>Shaded: 80% range</span>${marks.length ? '<span style="color:var(--orange)">Dashed: confirmed event added</span>' : ''}</div></div>
    <div class="card"><table><thead><tr><th>Date</th><th></th><th class="r">Estimate</th><th class="r">Low</th><th class="r">High</th><th>Drivers</th></tr></thead><tbody>
    ${series.slice(0, 14).map((s, i) => { const p = items.length === 1 ? plan.forecasts[items[0].id].points[i] : null; const date = addDays(plan.today, i); return `<tr><td>${date}</td><td>${DOW_NAMES[dayOfWeek(date)]}</td><td class="r num"><b>${f(s.y, 0)}</b></td><td class="r num">${f(s.lo, 0)}</td><td class="r num">${f(s.hi, 0)}</td><td class="small">${p ? `level ${f(p.components.level)} × weekday index ${f(p.components.dowIndex, 2)}${p.components.seasonal !== 1 ? ` × seasonal ${p.components.seasonal}` : ''}${p.components.eventUnits ? ` + event ${p.components.eventUnits}` : ''}` : ''}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="card"><b>Method and assumptions</b><ul class="small">
      <li>Model: ${esc(models[0].model.method)}; smoothing parameters chosen by minimising one-step error on each dish's own history (${models[0].model.nObs} days).</li>
      <li>Ranges are 80% intervals from in-sample errors; the real value lands outside about 1 day in 5.</li>
      <li>Seasonal multipliers and events are entered by you; they are not learned. History covers only ${models[0].model.nObs} days, so true annual seasonality is unknown.</li>
      <li>Not modelled: weather, promotions, competitor activity, supply gaps that capped past sales.</li>
      ${one && one.warnings?.length ? one.warnings.map((w) => `<li>${esc(w)}</li>`).join('') : ''}</ul></div>`;
  },

  menu() {
    return `${head('Recipes & menu', 'Quantities are per portion in the ingredient\'s purchase unit. Edits update the forecast immediately.')}
    ${data.recipes.map((r) => { const m = data.menuItems.find((x) => x.id === r.menu_item_id); const cost = r.lines.reduce((s, l) => s + l.qty / (data.ingredients.find((i) => i.id === l.ingredient_id).yield_pct) * (plan.unitCost[l.ingredient_id] || 0), 0);
      return `<div class="card"><div class="row" style="justify-content:space-between"><b>${esc(m.name)}</b><span class="small">${money(m.price)} · ingredient cost ≈ ${money(cost)} (${pct(cost / m.price)} of price, cheapest catalogue prices)</span></div>
      <table><tbody>${r.lines.map((l) => `<tr><td>${esc(ingName(l.ingredient_id))}</td><td class="r"><input class="sm" type="number" min="0" step="0.005" value="${l.qty}" data-act="recipe" data-item="${r.menu_item_id}" data-ing="${l.ingredient_id}" aria-label="${esc(m.name)} ${esc(ingName(l.ingredient_id))} per portion"> ${data.ingredients.find((i) => i.id === l.ingredient_id).unit}</td></tr>`).join('')}</tbody></table></div>`; }).join('')}`;
  },

  suppliers() {
    const comp = sel.compare || plan.recommendations.find((r) => r.rec.orderQty > 0)?.ingredientId || data.ingredients[0].id;
    const r = plan.recommendations.find((x) => x.ingredientId === comp);
    const need = Math.max(r.rec.needQty, r.ingredient.unit === 'each' ? 24 : 5);
    const rows = compareOffers({ ingredient: r.ingredient, qtyNeeded: need, offers: data.offers, suppliers: data.suppliers, daysToShortage: r.rec.daysToShortage });
    return `${head('Supplier catalogue', 'Offers include pack size, minimum order and lead time. Delivery fees are shared across an order, so the basket optimiser may pick a pricier line to avoid a second fee.')}
    <div class="row"><label>Compare offers for<select data-act="compare">${data.ingredients.map((i) => `<option value="${i.id}" ${i.id === comp ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></label></div>
    <div class="card"><div class="small">Comparing the cost of ${f(need)} ${r.ingredient.unit} ${r.rec.needQty <= 0 ? '(illustrative quantity; no order needed now)' : '(current need)'}${r.rec.daysToShortage != null ? ` · stock runs out in ${r.rec.daysToShortage} day(s)` : ''}</div>
    <table><thead><tr><th>Supplier</th><th class="r">Pack</th><th class="r">Pack price</th><th class="r">Min. order</th><th class="r">Lead</th><th class="r">Packs</th><th class="r">Goods</th><th class="r">Delivery*</th><th class="r">Landed</th><th class="r">Excess bought</th><th></th></tr></thead><tbody>
    ${rows.map((x, i) => `<tr><td><b>${esc(x.supplier.name)}</b></td><td class="r num">${x.offer.pack_size} ${r.ingredient.unit}</td><td class="r num">${money(x.offer.pack_price)}</td><td class="r num">${x.offer.moq_units || '–'}</td><td class="r num">${x.offer.lead_time_days}d</td><td class="r num">${x.packs}</td><td class="r num">${money(x.goods)}</td><td class="r num">${money(x.deliveryFee)}</td><td class="r num"><b>${money(x.landed)}</b></td><td class="r num">${f(x.excess)}</td><td>${!x.feasible ? '<span class="badge b-crit">arrives after stock-out</span>' : i === 0 ? '<span class="badge b-ok">best</span>' : ''}</td></tr>`).join('')}</tbody></table>
    <p class="small">*Delivery shown as if this were the only item on the order.</p></div>
    <h2>All suppliers</h2><div class="card"><table><thead><tr><th>Supplier</th><th class="r">Delivery fee</th><th class="r">Free over</th><th class="r">Min. order</th><th>Notes</th></tr></thead><tbody>${data.suppliers.map((s) => `<tr><td>${esc(s.name)}</td><td class="r num">${money(s.delivery_fee)}</td><td class="r num">${money(s.free_delivery_over)}</td><td class="r num">${money(s.min_order_value)}</td><td class="small">${esc(s.notes || '')}</td></tr>`).join('')}</tbody></table></div>`;
  },

  import() {
    const dates = data.sales.map((s) => s.date);
    const last = dates.reduce((a, b) => (a > b ? a : b));
    return `${head('Sales history import', 'Upload a CSV with a date, a menu item (name or ID) and units sold. In production, files go to a private S3 bucket and are validated and loaded by a Lambda function; here the file is processed locally in your browser and never uploaded.')}
    <div class="card"><div class="drop" id="drop"><p><b>Drop a CSV here</b> or choose a file</p><input type="file" accept=".csv,text/csv" id="file" aria-label="Choose sales CSV"><p class="small">Headers accepted: date · menu_item_id / item / dish · units_sold / units / quantity.  <a href="/data/sample_import.csv" download>Download a sample</a> · <a href="/data/sales_history.csv" download>Full demo history</a></p></div>
    <div id="import-result">${importState ? importHtml() : ''}</div></div>
    <div class="kpis"><div class="kpi"><b>${data.sales.length.toLocaleString()}</b><span>sales rows loaded</span></div><div class="kpi"><b>${dates.reduce((a, b) => (a < b ? a : b))}</b><span>first date</span></div><div class="kpi"><b>${last}</b><span>last date ${last < addDays(plan.today, -1) ? '· <b>history ends before yesterday</b>' : ''}</span></div></div>
    <p class="small">The forecast treats the history as running to the day before the plan date (${addDays(plan.today, -1)}); days with no row count as zero sales. Import fills those gaps.</p>`;
  },

  accuracy() {
    const a = plan.accuracy;
    return `${head('Forecast accuracy', `Rolling-origin backtest over the last ${plan.settings.backtestWeeks} weeks: each week was forecast using only data available before it.`)}
    <div class="kpis"><div class="kpi"><b>${pct(a.overall.wape)}</b><span>WAPE (lower is better)</span></div><div class="kpi"><b>${pct(a.overall.baselineSeasonalNaiveWape)}</b><span>"same weekday last week" baseline</span></div><div class="kpi"><b>${pct(a.overall.baselineMean7Wape)}</b><span>"last 7-day average" baseline</span></div><div class="kpi"><b>${pct(a.overall.bias)}</b><span>bias (+ = over-forecast)</span></div><div class="kpi"><b>${pct(a.overall.coverage80)}</b><span>actuals inside the 80% range (target ~80%)</span></div></div>
    <div class="card"><b>By dish</b><table><thead><tr><th>Dish</th><th class="r">WAPE</th><th class="r">Baseline: last week</th><th class="r">Baseline: 7-day avg</th><th class="r">Bias</th><th class="r">In 80% range</th></tr></thead><tbody>
    ${data.menuItems.map((m) => { const x = a.byItem[m.id]; return `<tr><td>${esc(m.name)}</td><td class="r num">${pct(x.wape)}</td><td class="r num">${pct(x.baselineSeasonalNaiveWape)}</td><td class="r num">${pct(x.baselineMean7Wape)}</td><td class="r num">${pct(x.bias)}</td><td class="r num">${pct(x.coverage80)}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="card"><b>By ingredient (daily demand)</b><table><thead><tr><th>Ingredient</th><th class="r">WAPE</th><th class="r">Bias</th></tr></thead><tbody>${a.byIngredient.map((x) => `<tr><td>${esc(ingName(x.ingredientId))}</td><td class="r num">${pct(x.wape)}</td><td class="r num">${pct(x.bias)}</td></tr>`).join('')}</tbody></table></div>
    <p class="small">WAPE = total absolute error ÷ total actual units. Daily dish-level error is naturally larger than weekly or ingredient-level error. This measures the forecast only; it does not measure waste or shortage outcomes. Backtests exclude planned events. Past accuracy does not guarantee future accuracy.</p>`;
  },

  settings() {
    const s = plan.settings;
    const fld = (k, label, step, min, max, hint) => `<label>${label}<input type="number" step="${step}" min="${min}" max="${max}" value="${s[k]}" data-act="setting" data-key="${k}"></label><p class="small" style="margin-top:0">${hint}</p>`;
    return `${head('Assumptions & settings', 'These drive every recommendation. Change one and see the effect.')}
    <div class="card" style="max-width:640px">
    ${fld('serviceLevel', 'Service level (0.80–0.999)', 0.01, 0.8, 0.999, 'Target chance of not running out during the order window. Higher = more safety stock.')}
    ${fld('demandCorrelation', 'Demand correlation between dishes (0–1)', 0.05, 0, 1, 'Assumption that busy days lift all dishes together. Higher = wider ingredient ranges.')}
    ${fld('seasonWeeks', 'Weeks used for weekday pattern', 1, 3, 12, 'More weeks = smoother pattern but slower to notice changes.')}
    ${fld('wasteValueAlert', 'Waste alert threshold ($)', 1, 0, 1000, 'Projected expiring stock below this value is not alerted.')}
    <button class="alt" data-act="reset">Reset demo data</button></div>
    <div class="card"><b>Per-ingredient rules</b><table><thead><tr><th>Ingredient</th><th class="r">Shelf life</th><th class="r">Days between orders</th><th class="r">Min safety days</th><th class="r">Max days cover</th><th class="r">Usable yield</th></tr></thead><tbody>
    ${data.ingredients.map((i) => `<tr><td>${esc(i.name)}</td><td class="r num">${i.shelf_life_days}d</td><td class="r"><input class="sm" type="number" min="1" value="${i.order_cycle_days}" data-act="ing" data-id="${i.id}" data-key="order_cycle_days"></td><td class="r"><input class="sm" type="number" min="0" step="0.5" value="${i.min_safety_days}" data-act="ing" data-id="${i.id}" data-key="min_safety_days"></td><td class="r"><input class="sm" type="number" min="1" value="${i.max_days_cover}" data-act="ing" data-id="${i.id}" data-key="max_days_cover"></td><td class="r num">${pct(i.yield_pct)}</td></tr>`).join('')}</tbody></table></div>`;
  },
};

function alertHtml(a) {
  return `<div class="alert ${a.severity}"><div>${sevBadge(a.severity)}</div><div><h3>${esc(a.title)}</h3><p>${esc(a.detail)}</p><p class="act">→ ${esc(a.action)}</p></div></div>`;
}

function explainHtml(id) {
  const e = explainRecommendation(plan, data, id);
  const u = e.unit;
  return `<h2 id="explain">Why: ${esc(e.ingredientName)}</h2><div class="card"><p><b>${esc(e.narrative)}</b></p>
  <div class="two"><div><table class="steps"><tbody>${e.steps.map((s) => `<tr><td>${s.effect === 'cap' ? '≤' : s.effect}</td><td>${esc(s.label)}</td><td class="r num">${f(s.value, 2)} ${s.key === 'packs' || s.key === 'net' || s.key === 'demand' || s.key === 'safety' || s.key === 'onhand' || s.key === 'expiring' || s.key === 'inbound' || s.key === 'cap' ? u : ''}</td></tr>`).join('')}</tbody></table>
  ${e.flags.map((x) => `<div class="msg w">${esc(x)}</div>`).join('')}</div>
  <div><b>Where the demand comes from</b><table><tbody>${e.contributions.map((c) => `<tr><td>${esc(c.name)}</td><td class="r num small">${f(c.forecastUnits, 0)} portions × ${c.perPortion} ${u}</td><td class="r num">${f(c.ingredientQty)} ${u}</td></tr>`).join('')}</tbody></table>
  ${e.events.length ? `<div class="msg o">Includes: ${e.events.map((x) => esc(`${x.date} +${x.extra_units} ${itemName(x.menu_item_id)} (${x.note})`)).join('; ')}</div>` : ''}</div></div>
  <b>How each input moves the result</b>
  <table><thead><tr><th>If…</th><th class="r">Net requirement</th><th class="r">Order quantity</th></tr></thead><tbody>
  <tr><td><b>Base case</b></td><td class="r num">${f(e.sensitivity.base.netRequirement)} ${u}</td><td class="r num"><b>${f(e.sensitivity.base.orderQty)} ${u}</b></td></tr>
  ${e.sensitivity.rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="r num">${r.deltaNet >= 0 ? '+' : ''}${f(r.deltaNet)}</td><td class="r num">${r.deltaOrder >= 0 ? '+' : ''}${f(r.deltaOrder)}</td></tr>`).join('')}</tbody></table>
  <p class="small">Order quantity moves in whole packs, so small changes in the net requirement may not change it.</p>
  <b>Assumptions</b><ul class="small">${e.assumptions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
  <p class="small">In production, Amazon Bedrock can rewrite this explanation in plain language from the structured data above. It never supplies or changes the numbers, and the built-in text is shown if the check fails.</p></div>`;
}

function importHtml() {
  const s = importState;
  return `${s.errors.slice(0, 8).map((e) => `<div class="msg e">${esc(e)}</div>`).join('')}${s.errors.length > 8 ? `<div class="msg e">…and ${s.errors.length - 8} more errors.</div>` : ''}${s.warnings.map((e) => `<div class="msg w">${esc(e)}</div>`).join('')}
  ${s.rows.length && !s.errors.length ? `<button data-act="commit-import">Import ${s.rows.length} rows</button>` : s.rows.length ? '<p class="small">Fix the errors above to import. Nothing has been changed.</p>' : ''}${s.done ? `<div class="msg o">${esc(s.done)}</div>` : ''}`;
}

// ---------- shell + events
function render() {
  const route = (location.hash.slice(1) || 'overview');
  const name = views[route] ? route : 'overview';
  const critical = plan.alerts.filter((a) => a.severity === 'critical').length;
  document.getElementById('side').innerHTML = `<a class="logo" href="/">PantryCircuit</a>${NAV.map(([k, l]) => `<a class="nav ${k === name ? 'on' : ''}" href="#${k}" ${k === name ? 'aria-current="page"' : ''}>${l}${k === 'alerts' && plan.alerts.filter((a) => a.severity !== 'info').length ? `<span class="cnt">${plan.alerts.filter((a) => a.severity !== 'info').length}</span>` : ''}</a>`).join('')}`;
  const v = document.getElementById('view');
  v.innerHTML = views[name]();
  document.title = `${NAV.find(([k]) => k === name)[1]} – PantryCircuit`;
  if (name === 'import') bindImport();
}

const view = document.getElementById('view');
view.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  if (t.dataset.act === 'explain') { sel.ingredient = t.dataset.id; document.getElementById('explain-panel').innerHTML = explainHtml(sel.ingredient); document.getElementById('explain').scrollIntoView({ behavior: 'smooth' }); }
  if (t.dataset.act === 'reset') { data = structuredClone(original); sel = { ingredient: null, item: 'all', compare: null }; recompute(); }
  if (t.dataset.act === 'commit-import') {
    const key = (r) => `${r.date}|${r.menu_item_id}`;
    const incoming = new Map(importState.rows.map((r) => [key(r), r]));
    data.sales = data.sales.filter((s) => !incoming.has(key(s))).concat(importState.rows);
    const n = importState.rows.length; importState = { rows: [], errors: [], warnings: [], done: `Imported ${n} rows (existing rows for the same date and dish were replaced). Forecasts updated.` };
    recompute();
  }
});
view.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset?.act === 'explain') e.target.click(); });
view.addEventListener('change', (e) => {
  const t = e.target, a = t.dataset.act; if (!a) return;
  const num = Number(t.value);
  if (a === 'item') { sel.item = t.value; return render(); }
  if (a === 'compare') { sel.compare = t.value; return render(); }
  if (!Number.isFinite(num) || num < 0) { t.value = ''; return; }
  if (a === 'stock') data.stock.find((s) => s.lot_id === t.dataset.lot).qty = num;
  if (a === 'recipe') data.recipes.find((r) => r.menu_item_id === t.dataset.item).lines.find((l) => l.ingredient_id === t.dataset.ing).qty = num;
  if (a === 'ing') data.ingredients.find((i) => i.id === t.dataset.id)[t.dataset.key] = num;
  if (a === 'setting') { const k = t.dataset.key; data.settings = { ...data.settings, [k]: k === 'serviceLevel' ? Math.min(0.999, Math.max(0.8, num)) : k === 'demandCorrelation' ? Math.min(1, num) : num }; }
  const y = window.scrollY; recompute(); window.scrollTo(0, y);
});

function bindImport() {
  const input = document.getElementById('file'), drop = document.getElementById('drop');
  const handle = async (file) => {
    if (!file) return;
    if (file.size > 5_000_000) { importState = { rows: [], errors: ['File is larger than 5 MB.'], warnings: [] }; }
    else importState = parseSalesCsv(await file.text(), data.menuItems);
    document.getElementById('import-result').innerHTML = importHtml();
  };
  input.addEventListener('change', () => handle(input.files[0]));
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handle(e.dataTransfer.files[0]));
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
render();
