// Forecast explanations: every recommendation is traceable to its inputs and
// assumptions. The narrative here is deterministic; Amazon Bedrock may rephrase
// it (src/ai/bedrock.mjs) but never supplies the numbers.
import { sensitivity } from './purchasing.mjs';
import { sum } from './stats.mjs';

const f = (x, dp = 1) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(dp));

export function explainRecommendation(plan, data, ingredientId) {
  const r = plan.recommendations.find((x) => x.ingredientId === ingredientId);
  if (!r) throw new Error(`Unknown ingredient ${ingredientId}`);
  const { rec, info, offer, supplier } = r;
  const ing = r.ingredient;
  const W = rec.windowDays;
  const u = ing.unit;

  const contributions = data.menuItems
    .map((m) => ({
      menuItemId: m.id,
      name: m.name,
      forecastUnits: sum((plan.forecasts[m.id]?.points || []).slice(0, W).map((p) => p.point)),
      ingredientQty: sum(info.demand.slice(0, W).map((d) => d.byItem[m.id] || 0)),
      perPortion: data.recipes.find((x) => x.menu_item_id === m.id)?.lines.find((l) => l.ingredient_id === ing.id)?.qty ?? 0,
    }))
    .filter((c) => c.ingredientQty > 0)
    .sort((a, b) => b.ingredientQty - a.ingredientQty);

  const windowEnd = info.demand[W - 1]?.date;
  const events = data.events.filter((e) => e.date >= plan.today && e.date <= windowEnd && contributions.some((c) => c.menuItemId === e.menu_item_id));
  const seasonal = data.seasonal.filter((s) => contributions.some((c) => c.menuItemId === s.menu_item_id));

  const sens = sensitivity({ ingredient: ing, demand: info.dem, lots: info.lots, inbound: info.inbound, offer, settings: plan.settings, today: plan.today });

  const confidences = contributions.map((c) => plan.forecasts[c.menuItemId]?.model.confidence);
  const assumptions = [
    `Demand is a statistical estimate from sales history up to ${plan.histEnd} (damped-trend smoothing with day-of-week patterns). It is not a guarantee.`,
    `Ranges shown are 80% intervals derived from past forecast errors; real demand falls outside them about 1 time in 5.`,
    `Safety stock assumes forecast errors are independent from day to day and ${(plan.settings.demandCorrelation * 100).toFixed(0)}% correlated across dishes (an assumption, not a measurement).`,
    `Recipe quantities and the ${(ing.yield_pct * 100).toFixed(0)}% usable yield are as configured; actual portioning may differ.`,
    `Stock counts are taken as entered and assumed accurate, with first-expired-first-out usage.`,
    offer ? `Lead time (${offer.lead_time_days} day${offer.lead_time_days === 1 ? '' : 's'}) and prices are the supplier's quoted terms, not measured delivery performance.` : 'No supplier offer is on file for this ingredient.',
  ];
  if (seasonal.length) assumptions.push(`Seasonal multipliers are user-entered assumptions (${seasonal.map((s) => `${data.menuItems.find((m) => m.id === s.menu_item_id)?.name} ×${s.multiplier} in month ${s.month}`).join('; ')}), not learned from data.`);
  if (events.length) assumptions.push(`Planned events included: ${events.map((e) => `${e.date} +${e.extra_units} ${data.menuItems.find((m) => m.id === e.menu_item_id)?.name} (${e.note})`).join('; ')}.`);
  if (confidences.some((c) => c && c !== 'normal')) assumptions.push('Some dishes have short sales history, so their forecasts have low confidence.');

  const lines = [];
  if (rec.orderQty > 0) {
    lines.push(`Estimate: order ${f(rec.orderQty)} ${u} of ${ing.name}${rec.packs ? ` (${rec.packs} × ${offer.pack_size} ${u})` : ''}${supplier ? ` from ${supplier.name}, ${rec.leadDays}-day lead time` : ''}.`);
  } else {
    lines.push(`Estimate: no order needed for ${ing.name} today.`);
  }
  lines.push(`Forecast demand over the next ${W} days (lead time plus review period) is ${f(rec.demandWindow)} ${u}, roughly ${f(rec.demandWindowLow)}–${f(rec.demandWindowHigh)} ${u} at 80% confidence.`);
  lines.push(`A safety buffer of ${f(rec.safetyStock)} ${u} is added (${rec.safetyBasis === 'service-level' ? `${(plan.settings.serviceLevel * 100).toFixed(0)}% service level` : `minimum ${ing.min_safety_days} days of use`}).`);
  lines.push(`Usable stock is ${f(rec.usableStock)} ${u}${rec.expiringBeforeUse < 0.05 && rec.inboundInWindow === 0 ? ' (all on hand)' : `: ${f(rec.onHand)} on hand`}${rec.expiringBeforeUse > 0.05 ? `, less ${f(rec.expiringBeforeUse)} expected to expire before use` : ''}${rec.inboundInWindow > 0 ? `, plus ${f(rec.inboundInWindow)} already on order` : ''}.`);
  if (rec.moqDriven) lines.push('The quantity was raised to meet the supplier minimum order.');
  if (rec.limitedByShelfLife) lines.push('The quantity was capped so it can be used before it spoils or exceeds the maximum days of cover.');

  return {
    ingredientId,
    ingredientName: ing.name,
    unit: u,
    asOf: plan.today,
    recommendation: { orderQty: rec.orderQty, packs: rec.packs, urgency: rec.urgency, supplier: supplier?.name ?? null, leadDays: rec.leadDays, estimatedGoodsCost: r.cost },
    steps: rec.steps,
    contributions,
    events,
    sensitivity: sens,
    assumptions,
    flags: rec.flags,
    narrative: lines.join(' '),
  };
}
