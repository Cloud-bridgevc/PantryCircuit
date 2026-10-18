import { recommendOrder, sensitivity, runPlan } from '/engine/index.mjs';

const $ = (s, r = document) => r.querySelector(s);
const f = (x, d = 1) => Number(x).toFixed(d);

// ---- Hero card: live from the same engine and fictional data as the dashboard
try {
  const data = await (await fetch('/data/demo.json')).json();
  const plan = runPlan(data);
  const r = plan.recommendations.filter((x) => x.rec.orderQty > 0).sort((a, b) => (b.rec.urgency === 'expedite') - (a.rec.urgency === 'expedite') || b.cost - a.cost)[0];
  $('#hc-name').textContent = r.ingredient.name;
  $('#hc-qty').textContent = `Order ${f(r.rec.orderQty)} ${r.ingredient.unit} today (estimate)`;
  $('#hc-why').textContent = `Forecast use over the next ${r.rec.windowDays} days is about ${f(r.rec.demandWindow)} ${r.ingredient.unit}; ${f(r.rec.onHand)} on hand; ${f(r.rec.safetyStock)} safety buffer; ${r.supplier.name}, ${r.rec.leadDays}-day lead time.`;
} catch { $('#hc-name').textContent = 'Sample unavailable'; }

// ---- Calculator
const form = $('#calc-form');
function calc() {
  const v = Object.fromEntries(new FormData(form));
  const n = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)]));
  const err = $('#calc-err');
  const bad = ['avg', 'sd', 'stock', 'inbound', 'lead', 'cycle', 'pack', 'moq', 'price', 'shelf', 'expiry'].find((k) => !Number.isFinite(n[k]) || n[k] < 0);
  if (bad || n.pack <= 0 || n.shelf < 1 || n.cycle < 1 || n.expiry < 1) { err.textContent = 'Check the highlighted values: all inputs must be positive numbers (pack size, shelf life and days between orders at least 1/0.1).'; return; }
  err.textContent = '';
  const days = 30, today = '2026-01-01';
  const demand = { mean: Array(days).fill(n.avg), sd: Array(days).fill(n.sd) };
  const addD = (k) => new Date(Date.UTC(2026, 0, 1 + k)).toISOString().slice(0, 10);
  const lots = n.stock > 0 ? [{ id: 'stock', qty: n.stock, expiry: addD(n.expiry - 1) }] : [];
  const inbound = n.inbound > 0 ? [{ id: 'po', qty: n.inbound, arrival: addD(Math.min(n.lead, days - 1)), expiry: addD(Math.min(n.lead, days - 1) + n.shelf - 1) }] : [];
  const ingredient = { id: 'x', name: 'Ingredient', unit: 'kg', shelf_life_days: n.shelf, order_cycle_days: n.cycle, min_safety_days: 0, max_days_cover: Math.max(n.shelf, 1) };
  const offer = { pack_size: n.pack, moq_units: n.moq, lead_time_days: n.lead };
  const base = { ingredient, demand, lots, inbound, offer, settings: { serviceLevel: n.sl }, today };
  const r = recommendOrder(base);
  const s = sensitivity(base);
  const cost = (r.packs || 0) * n.price;
  const urg = r.urgency === 'expedite' ? '<span class="badge b-crit">Stock-out likely before delivery</span>' : r.orderQty > 0 ? '<span class="badge b-warn">Order today</span>' : '<span class="badge b-ok">No order needed</span>';
  $('#calc-out').innerHTML = `
    <div class="result"><div>${urg}</div><div class="big num">${f(r.orderQty)} kg</div>
      <div>${r.packs ?? 0} × ${f(n.pack)} kg pack${r.packs === 1 ? '' : 's'} · about $${f(cost, 2)} before delivery fees (estimate)</div></div>
    <table class="t"><caption class="small" style="text-align:left">How the number was built</caption>
      ${r.steps.map((st) => `<tr><td>${st.effect === 'cap' ? '≤' : st.effect}</td><td>${st.label}</td><td class="r num">${f(st.value)}</td></tr>`).join('')}</table>
    ${r.flags.map((x) => `<p class="small">⚠ ${x}</p>`).join('')}
    <table class="t" style="margin-top:12px"><caption class="small" style="text-align:left">What if…? (change in order quantity)</caption>
      ${s.rows.map((x) => `<tr><td>${x.label}</td><td class="r num">${x.deltaOrder > 0 ? '+' : ''}${f(x.deltaOrder)} kg</td></tr>`).join('')}</table>
    <p class="small">Assumes steady daily use with the variation you entered, independent day to day. Real demand varies; treat this as an estimate.</p>`;
}
form.addEventListener('input', calc); calc();

// ---- Demo form
const dform = $('#demo-form'), status = $('#demo-status');
dform.addEventListener('submit', async (e) => {
  e.preventDefault();
  dform.querySelectorAll('.err').forEach((x) => (x.textContent = ''));
  const body = Object.fromEntries(new FormData(dform));
  body.consent = dform.consent.checked;
  status.textContent = 'Sending…';
  try {
    const res = await fetch('/api/demo-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json();
    if (res.ok && out.ok) { status.textContent = 'Thanks! We have your request and will be in touch to schedule a demo.'; dform.reset(); return; }
    for (const [k, m] of Object.entries(out.errors || {})) { const el = dform.querySelector(`[data-for="${k}"]`); if (el) el.textContent = m; }
    status.textContent = out.errors ? 'Please fix the highlighted fields.' : 'Something went wrong. Please try again.';
  } catch { status.textContent = 'Could not send the request. Check your connection and try again.'; }
});
