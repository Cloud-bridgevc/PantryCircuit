// Recipe-to-inventory conversion and first-expired-first-out stock simulation.
import { addDays } from './dates.mjs';
import { sum, Z80 } from './stats.mjs';

/**
 * Convert item forecasts into per-ingredient daily demand (purchase units).
 * Variance across items assumes a partial positive correlation `rho` (busy days
 * lift every dish), which is an assumption, not a measured value.
 */
export function ingredientDemand({ forecasts, recipes, ingredients, rho = 0.3 }) {
  const out = new Map();
  const first = Object.values(forecasts).find((f) => f.points.length);
  if (!first) return out;
  const days = first.points.length;
  for (const ing of ingredients) {
    const daily = [];
    for (let i = 0; i < days; i++) {
      const byItem = {};
      let meanSum = 0;
      let varInd = 0;
      let sdSum = 0;
      for (const r of recipes) {
        const line = r.lines.find((l) => l.ingredient_id === ing.id);
        const p = forecasts[r.menu_item_id]?.points[i];
        if (!line || !p) continue;
        const perUnit = line.qty / (ing.yield_pct || 1);
        const q = perUnit * p.point;
        byItem[r.menu_item_id] = q;
        meanSum += q;
        const s = perUnit * p.sd;
        varInd += s * s;
        sdSum += s;
      }
      const sd = Math.sqrt((1 - rho) * varInd + rho * sdSum * sdSum);
      daily.push({ date: first.points[i].date, mean: meanSum, sd, low: Math.max(0, meanSum - Z80 * sd), high: meanSum + Z80 * sd, byItem });
    }
    out.set(ing.id, daily);
  }
  return out;
}

/**
 * Day-by-day FEFO simulation.
 * lots: [{id, qty, expiry}] (expiry = last usable day), inbound: [{id, qty, arrival, expiry}]
 * demand: number[] aligned to startDate.
 */
export function simulateStock({ startDate, lots, inbound = [], demand }) {
  const live = lots.filter((l) => l.qty > 0).map((l) => ({ ...l }));
  const daily = [];
  const wasted = [];
  let shortTotal = 0;
  let firstShortDate = null;
  for (let i = 0; i < demand.length; i++) {
    const date = addDays(startDate, i);
    for (const lot of live) {
      if (lot.qty > 1e-9 && lot.expiry < date) {
        wasted.push({ lotId: lot.id, date, qty: lot.qty, expiry: lot.expiry });
        lot.qty = 0;
      }
    }
    for (const p of inbound) if (p.arrival === date) live.push({ id: p.id, qty: p.qty, expiry: p.expiry });
    live.sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
    let need = demand[i];
    for (const lot of live) {
      if (need <= 1e-9) break;
      const take = Math.min(lot.qty, need);
      lot.qty -= take;
      need -= take;
    }
    const short = need > 1e-9 ? need : 0;
    if (short) {
      shortTotal += short;
      firstShortDate ??= date;
    }
    daily.push({ date, closing: sum(live.map((l) => l.qty)), short });
  }
  return {
    daily,
    wasted,
    wasteQty: sum(wasted.map((w) => w.qty)),
    shortTotal,
    firstShortDate,
    endLots: live.filter((l) => l.qty > 1e-9).map((l) => ({ ...l })),
  };
}

/** Lots + inbound for one ingredient in the shape the simulator expects. */
export function stockFor(data, ingredient) {
  const lots = data.stock
    .filter((s) => s.ingredient_id === ingredient.id)
    .map((s) => ({ id: s.lot_id, qty: s.qty, expiry: s.expiry_date, received: s.received_date }));
  const inbound = (data.inbound || [])
    .filter((p) => p.ingredient_id === ingredient.id)
    .map((p) => ({
      id: p.po_ref,
      qty: p.qty,
      arrival: p.arrival_date,
      expiry: addDays(p.arrival_date, (p.shelf_life_days ?? ingredient.shelf_life_days) - 1),
    }));
  return { lots, inbound };
}
