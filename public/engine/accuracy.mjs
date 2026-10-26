// Rolling-origin backtest: how well would this method have forecast the most
// recent weeks, using only data available at each forecast origin?
import { addDays } from './dates.mjs';
import { forecastItem, toDailySeries } from './forecast.mjs';
import { sum } from './stats.mjs';

const metrics = (pairs) => {
  const actual = sum(pairs.map((p) => p.a));
  const wape = (key) => (actual > 0 ? sum(pairs.map((p) => Math.abs(p[key] - p.a))) / actual : null);
  return {
    wape: wape('f'),
    bias: actual > 0 ? sum(pairs.map((p) => p.f - p.a)) / actual : null,
    baselineSeasonalNaiveWape: wape('naive'),
    baselineMean7Wape: wape('mean7'),
    coverage80: pairs.length ? pairs.filter((p) => p.a >= p.low && p.a <= p.high).length / pairs.length : null,
    n: pairs.length,
    actualUnits: actual,
  };
};

export function backtestItem({ rows, histEnd, weeks = 4, horizon = 7, itemOpts = {}, start }) {
  const full = toDailySeries(rows, start, histEnd);
  const pairs = [];
  for (let k = weeks; k >= 1; k--) {
    const trainEnd = addDays(histEnd, -horizon * k);
    const nTrain = full.dates.indexOf(trainEnd) + 1;
    if (nTrain < 21) continue;
    const train = { dates: full.dates.slice(0, nTrain), values: full.values.slice(0, nTrain) };
    const fc = forecastItem(train, horizon, { ...itemOpts, events: [] });
    const m7 = sum(train.values.slice(-7)) / 7;
    fc.points.forEach((p, h) => {
      const i = nTrain + h;
      pairs.push({ date: p.date, a: full.values[i], f: p.point, low: p.low, high: p.high, naive: full.values[i - 7], mean7: m7 });
    });
  }
  return { ...metrics(pairs), pairs };
}

/** Roll item-level backtest pairs up to ingredient demand via recipes. */
export function ingredientAccuracy(itemResults, recipes, ingredients) {
  return ingredients.map((ing) => {
    const byDate = new Map();
    for (const r of recipes) {
      const line = r.lines.find((l) => l.ingredient_id === ing.id);
      const res = itemResults[r.menu_item_id];
      if (!line || !res) continue;
      const q = line.qty / (ing.yield_pct || 1);
      for (const p of res.pairs) {
        const e = byDate.get(p.date) || { a: 0, f: 0 };
        e.a += q * p.a;
        e.f += q * p.f;
        byDate.set(p.date, e);
      }
    }
    const days = [...byDate.values()];
    const actual = sum(days.map((d) => d.a));
    return {
      ingredientId: ing.id,
      wape: actual > 0 ? sum(days.map((d) => Math.abs(d.f - d.a))) / actual : null,
      bias: actual > 0 ? sum(days.map((d) => d.f - d.a)) / actual : null,
      n: days.length,
    };
  });
}

export function aggregate(itemResults) {
  const all = Object.values(itemResults).flatMap((r) => r.pairs);
  return metrics(all);
}
