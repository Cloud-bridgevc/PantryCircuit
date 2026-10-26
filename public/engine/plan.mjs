// Orchestrates the full planning run: forecast → ingredient demand → stock
// simulation → purchase recommendations → supplier basket → alerts → accuracy.
import { addDays, daysBetween, monthOf } from './dates.mjs';
import { forecastItem, toDailySeries } from './forecast.mjs';
import { ingredientDemand, simulateStock, stockFor } from './inventory.mjs';
import { recommendOrder } from './purchasing.mjs';
import { compareOffers, optimizeBasket } from './suppliers.mjs';
import { aggregate, backtestItem, ingredientAccuracy } from './accuracy.mjs';
import { mean, sum } from './stats.mjs';

export const DEFAULT_SETTINGS = {
  horizonDays: 28,
  serviceLevel: 0.95,
  demandCorrelation: 0.3,
  seasonWeeks: 8,
  backtestWeeks: 4,
  shortageWarningDays: 2, // warn when stock runs out within this many days unless an order is placed
  wasteValueAlert: 5, // currency units of projected waste before a waste alert is raised
};

export function cheapestUnitCost(data, ingredient) {
  if (ingredient.unit_cost != null) return ingredient.unit_cost;
  const costs = data.offers.filter((o) => o.ingredient_id === ingredient.id).map((o) => o.pack_price / o.pack_size);
  return costs.length ? Math.min(...costs) : 0;
}

function seasonalFn(data, itemId) {
  const byMonth = new Map(data.seasonal.filter((s) => s.menu_item_id === itemId).map((s) => [s.month, s.multiplier]));
  return (date) => byMonth.get(monthOf(date)) ?? 1;
}

export function runPlan(data, overrides = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}), ...overrides };
  const today = data.meta.asOf;
  const histEnd = addDays(today, -1);
  const unitCost = Object.fromEntries(data.ingredients.map((i) => [i.id, cheapestUnitCost(data, i)]));

  // 1. Item forecasts
  const forecasts = {};
  const itemOptsById = {};
  for (const item of data.menuItems) {
    const rows = data.sales.filter((s) => s.menu_item_id === item.id);
    if (!rows.length) { forecasts[item.id] = { points: [], model: { method: 'none', confidence: 'none', nObs: 0, warnings: ['No sales history.'] } }; continue; }
    const start = rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date);
    const opts = {
      closedDows: item.closed_dows || [],
      seasonalMultiplier: seasonalFn(data, item.id),
      events: data.events.filter((e) => e.menu_item_id === item.id && e.date >= today),
      unavailable: new Set(item.unavailable_dates || []),
      seasonWeeks: settings.seasonWeeks,
    };
    itemOptsById[item.id] = { opts, start, rows };
    forecasts[item.id] = forecastItem(toDailySeries(rows, start, histEnd), settings.horizonDays, opts);
  }

  // 2. Ingredient demand
  const demand = ingredientDemand({ forecasts, recipes: data.recipes, ingredients: data.ingredients, rho: settings.demandCorrelation });

  // 3. Per-ingredient simulation + per-offer recommendations
  const perIngredient = [];
  const candidates = [];
  for (const ing of data.ingredients) {
    const d = demand.get(ing.id) || [];
    const dem = { mean: d.map((x) => x.mean), sd: d.map((x) => x.sd) };
    const { lots, inbound } = stockFor(data, ing);
    const onHand = sum(lots.map((l) => l.qty));
    const meanSim = simulateStock({ startDate: today, lots, inbound, demand: dem.mean });
    const lowSim = simulateStock({ startDate: today, lots, inbound, demand: d.map((x) => x.low) });
    const highSim = simulateStock({ startDate: today, lots, inbound, demand: d.map((x) => x.high) });
    const avg14 = mean(dem.mean.slice(0, 14));
    const offers = data.offers.filter((o) => o.ingredient_id === ing.id);
    const recs = (offers.length ? offers : [null]).map((offer) => ({
      offer,
      rec: recommendOrder({ ingredient: ing, demand: dem, lots, inbound, offer, settings, today }),
    }));
    const options = recs
      .filter((r) => r.rec.orderQty > 1e-9 && r.offer)
      .map((r) => ({
        offer: r.offer,
        qty: r.rec.orderQty,
        goods: r.rec.packs * r.offer.pack_price,
        feasible: r.rec.daysToShortage == null || r.offer.lead_time_days <= r.rec.daysToShortage,
        rec: r.rec,
      }));
    const info = {
      ingredient: ing,
      demand: d,
      dem,
      lots,
      inbound,
      onHand,
      daysOfCover: avg14 > 0 ? onHand / avg14 : null,
      avgDailyDemand: avg14,
      unitCost: unitCost[ing.id],
      sim: { mean: meanSim, low: lowSim, high: highSim },
      allRecs: recs,
      options,
    };
    perIngredient.push(info);
    if (options.length) candidates.push({ ingredientId: ing.id, options });
  }

  // 4. Choose suppliers across the whole basket
  const basket = optimizeBasket(candidates, data.suppliers);
  const chosen = Object.fromEntries(basket.lines.map((l) => [l.ingredientId, l]));

  const recommendations = perIngredient.map((info) => {
    const ing = info.ingredient;
    const pick = chosen[ing.id];
    let rec, offer;
    if (pick) { rec = pick.rec; offer = pick.offer; }
    else {
      // nothing to buy: display the recommendation for the fastest supplier
      const best = info.allRecs.slice().sort((a, b) => (a.offer?.lead_time_days ?? 99) - (b.offer?.lead_time_days ?? 99))[0];
      rec = best.rec; offer = best.offer;
    }
    const comparison = offer || info.options.length
      ? compareOffers({ ingredient: ing, qtyNeeded: Math.max(rec.needQty, 1e-6), offers: data.offers, suppliers: data.suppliers, daysToShortage: rec.daysToShortage })
      : [];
    return { ingredientId: ing.id, ingredient: ing, rec, offer, supplier: offer ? data.suppliers.find((s) => s.id === offer.supplier_id) : null, comparison, cost: pick ? pick.goods : 0, info };
  });

  // 5. Alerts
  const alerts = buildAlerts({ data, settings, today, perIngredient, recommendations });

  // 6. Accuracy
  const itemResults = {};
  for (const item of data.menuItems) {
    const it = itemOptsById[item.id];
    if (!it) continue;
    itemResults[item.id] = backtestItem({ rows: it.rows, start: it.start, histEnd, weeks: settings.backtestWeeks, itemOpts: it.opts });
  }
  const accuracy = {
    byItem: itemResults,
    overall: aggregate(itemResults),
    byIngredient: ingredientAccuracy(itemResults, data.recipes, data.ingredients),
  };

  return { settings, today, histEnd, forecasts, demand, perIngredient, recommendations, basket, alerts, accuracy, unitCost };
}

function buildAlerts({ settings, today, perIngredient, recommendations }) {
  const alerts = [];
  const recById = Object.fromEntries(recommendations.map((r) => [r.ingredientId, r]));
  for (const info of perIngredient) {
    const ing = info.ingredient;
    const r = recById[ing.id];
    const rec = r.rec;
    const u = ing.unit;
    const fmt = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1));

    // Shortage: stock projected to run out (existing stock + inbound only)
    const ms = info.sim.mean;
    const hs = info.sim.high;
    const dtsMean = ms.firstShortDate ? daysBetween(today, ms.firstShortDate) : null;
    const dtsHigh = hs.firstShortDate ? daysBetween(today, hs.firstShortDate) : null;
    if (dtsMean !== null && (dtsMean < rec.leadDays || dtsMean <= settings.shortageWarningDays)) {
      const beforeDelivery = dtsMean < rec.leadDays;
      alerts.push({
        id: `short-${ing.id}`, type: 'shortage', severity: beforeDelivery ? 'critical' : 'warning', ingredientId: ing.id,
        title: `${ing.name} ${beforeDelivery ? 'will run out before a delivery can arrive' : `runs out ${dtsMean === 0 ? 'today' : `in ${dtsMean} day${dtsMean === 1 ? '' : 's'}`} unless you order`}`,
        detail: `${fmt(info.onHand)} ${u} on hand; the central forecast is short from ${ms.firstShortDate}.${beforeDelivery ? ` The quickest supplier lead time is ${rec.leadDays} day${rec.leadDays === 1 ? '' : 's'}.` : ''}`,
        action: beforeDelivery ? 'Ask for same-day supply, borrow from a sister site, or adjust the menu.' : `Order ${fmt(rec.orderQty)} ${u} today.`,
        metrics: { firstShortDate: ms.firstShortDate, daysToShortage: dtsMean, shortQtyHorizon: ms.shortTotal },
      });
    } else if (dtsHigh !== null && dtsHigh <= settings.shortageWarningDays) {
      alerts.push({
        id: `short-${ing.id}`, type: 'shortage', severity: 'info', ingredientId: ing.id,
        title: `${ing.name}: shortage possible if demand runs high`,
        detail: `Not short on the central forecast, but the high-demand case (about a 1-in-10 chance of being exceeded) runs out ${hs.firstShortDate}.`,
        action: rec.orderQty > 0 ? `The recommended ${fmt(rec.orderQty)} ${u} order covers this.` : 'Monitor.',
        metrics: { firstShortDate: hs.firstShortDate, daysToShortage: dtsHigh },
      });
    }

    // Waste: stock expiring before it is projected to be used
    const wasteMean = info.sim.mean.wasteQty;
    const wasteLow = info.sim.low.wasteQty;
    const cost = info.unitCost;
    if (wasteMean * cost >= settings.wasteValueAlert) {
      const w = info.sim.mean.wasted[0];
      alerts.push({
        id: `waste-${ing.id}`, type: 'waste', severity: wasteMean / Math.max(info.onHand, 1e-9) >= 0.25 ? 'critical' : 'warning', ingredientId: ing.id,
        title: `${ing.name}: about ${fmt(wasteMean)} ${u} may expire unused`,
        detail: `On the central forecast ${fmt(wasteMean)} ${u} (≈ ${(wasteMean * cost).toFixed(0)} at catalogue cost) passes its use-by date, first on ${w.expiry}. In a low-demand case (about 1-in-10) it would be ${fmt(wasteLow)} ${u}.`,
        action: 'Feature it on a special, move it to prep today, or skip the next order for this item.',
        metrics: { wasteQty: wasteMean, wasteQtyLowCase: wasteLow, wasteValue: wasteMean * cost, firstExpiry: w.expiry },
      });
    } else if (wasteLow * cost >= settings.wasteValueAlert) {
      alerts.push({
        id: `waste-${ing.id}`, type: 'waste', severity: 'info', ingredientId: ing.id,
        title: `${ing.name}: waste possible if demand runs low`,
        detail: `No expected waste on the central forecast, but ${fmt(wasteLow)} ${u} would expire in the low-demand case.`,
        action: 'Avoid topping up beyond the recommendation.',
        metrics: { wasteQtyLowCase: wasteLow },
      });
    }

    // Overstock
    const cap = ing.max_days_cover ?? 30;
    if (info.daysOfCover != null && info.daysOfCover > cap && !alerts.some((a) => a.id === `waste-${ing.id}`)) {
      alerts.push({
        id: `over-${ing.id}`, type: 'overstock', severity: 'warning', ingredientId: ing.id,
        title: `${ing.name}: ${info.daysOfCover.toFixed(0)} days of cover on hand`,
        detail: `${fmt(info.onHand)} ${u} against ${fmt(info.avgDailyDemand)} ${u}/day forecast use (limit ${cap} days).`,
        action: 'Pause ordering this ingredient.',
        metrics: { daysOfCover: info.daysOfCover },
      });
    }
  }
  const rank = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
