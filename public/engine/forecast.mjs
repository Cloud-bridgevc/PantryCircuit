// Quantitative demand forecasting for one menu item.
//
// Method: multiplicative day-of-week seasonality + damped-trend exponential
// smoothing (Holt) on the de-seasonalised series. Smoothing parameters are
// chosen by minimising one-step-ahead squared error on the item's own history.
// Known seasonal multipliers (user-configured) and planned events (e.g. a
// catering order) are applied on top. Intervals come from in-sample residuals.
//
// This is a statistical estimate. It cannot see anything that is not in the
// history or the configured inputs (weather, competitor promos, supply gaps).
import { addDays, dayOfWeek } from './dates.mjs';
import { mean, rmse, sum, Z80 } from './stats.mjs';

export const PHI = 0.9; // trend damping
const ALPHAS = [0.05, 0.1, 0.2, 0.3, 0.4];
const BETAS = [0, 0.02, 0.05];
const WARMUP = 14;

/** Day-of-week indices (mean 1 across open days) from the last `weeks` weeks. */
export function seasonalIndices(values, dates, closedDows = [], weeks = 8) {
  const n = Math.min(values.length, weeks * 7);
  const sums = Array(7).fill(0);
  const cnt = Array(7).fill(0);
  for (let i = values.length - n; i < values.length; i++) {
    const d = dayOfWeek(dates[i]);
    if (closedDows.includes(d)) continue;
    sums[d] += values[i];
    cnt[d]++;
  }
  const total = sum(cnt);
  const overall = total ? sum(sums) / total : 0;
  const idx = Array(7).fill(0);
  for (let d = 0; d < 7; d++) {
    if (closedDows.includes(d)) continue;
    const raw = cnt[d] && overall > 0 ? sums[d] / cnt[d] / overall : 1;
    const w = Math.min(1, cnt[d] / 4); // full weight from 4 observations; shrink toward 1 below that
    idx[d] = w * raw + (1 - w);
  }
  const open = idx.filter((_, d) => !closedDows.includes(d));
  const m = mean(open) || 1;
  return idx.map((v, d) => (closedDows.includes(d) ? 0 : v / m));
}

function runHolt(y, idxByPos, alpha, beta) {
  let level = mean(y.slice(0, 7).filter((_, i) => idxByPos[i] > 0));
  let trend = 0;
  const fitted = [];
  for (let t = 0; t < y.length; t++) {
    const f = level + PHI * trend;
    fitted.push(f);
    if (idxByPos[t] === 0) continue; // closed day: no information
    const prev = level;
    level = alpha * y[t] + (1 - alpha) * (prev + PHI * trend);
    trend = beta * (level - prev) + (1 - beta) * PHI * trend;
  }
  return { level, trend, fitted };
}

/**
 * @param {{dates:string[], values:number[]}} series contiguous daily history
 * @param {number} horizon days to forecast
 * @param {object} opts closedDows, seasonalMultiplier(date)->number, events[{date,extra_units,note}], unavailable:Set<string>, seasonWeeks
 */
export function forecastItem(series, horizon, opts = {}) {
  const { dates, values } = series;
  const { closedDows = [], seasonalMultiplier = () => 1, events = [], unavailable = new Set(), seasonWeeks = 8 } = opts;
  const n = values.length;
  const warnings = [];
  if (n === 0) {
    return { points: [], model: { method: 'none', confidence: 'none', nObs: 0, warnings: ['No sales history for this item.'] } };
  }
  const idx = seasonalIndices(values, dates, closedDows, seasonWeeks);
  const pos = dates.map((d) => idx[dayOfWeek(d)]);
  const y = values.map((v, i) => (pos[i] > 0 ? v / pos[i] : 0));

  let best = { alpha: 0.2, beta: 0, sse: Infinity };
  let confidence = 'normal';
  if (n < 28) {
    confidence = n < 14 ? 'very low' : 'low';
    warnings.push(`Only ${n} days of history; estimates are rough (28+ days recommended).`);
    const run = runHolt(y, pos, 0.2, 0);
    best = { alpha: 0.2, beta: 0, ...run };
  } else {
    for (const alpha of ALPHAS) {
      for (const beta of BETAS) {
        const run = runHolt(y, pos, alpha, beta);
        let sse = 0;
        for (let t = WARMUP; t < n; t++) if (pos[t] > 0) sse += (values[t] - run.fitted[t] * pos[t]) ** 2;
        if (sse < best.sse) best = { alpha, beta, sse, ...run };
      }
    }
  }
  const errs = [];
  for (let t = Math.min(WARMUP, n - 1); t < n; t++) if (pos[t] > 0) errs.push(values[t] - best.fitted[t] * pos[t]);
  const sigma = rmse(errs);

  const eventByDate = new Map();
  for (const e of events) eventByDate.set(e.date, (eventByDate.get(e.date) || 0) + Number(e.extra_units || 0));

  const last = dates[n - 1];
  const points = [];
  let trendAcc = 0;
  let phiPow = 1;
  for (let h = 1; h <= horizon; h++) {
    phiPow *= PHI;
    trendAcc += phiPow * best.trend;
    const date = addDays(last, h);
    const dow = dayOfWeek(date);
    const seasonal = seasonalMultiplier(date);
    const closed = closedDows.includes(dow) || unavailable.has(date);
    const levelH = best.level + trendAcc;
    const baseline = closed ? 0 : Math.max(0, levelH * idx[dow]);
    const adjusted = baseline * seasonal;
    const eventUnits = eventByDate.get(date) || 0;
    const point = adjusted + eventUnits;
    const sd = closed ? 0 : sigma * Math.sqrt(Math.max(idx[dow], 0.25)) * Math.sqrt(1 + (h - 1) * best.alpha ** 2) * seasonal;
    points.push({
      date,
      point,
      low: Math.max(0, point - Z80 * sd),
      high: point + Z80 * sd,
      sd,
      components: { level: levelH, dowIndex: idx[dow], seasonal, eventUnits, closed },
    });
  }
  return {
    points,
    model: {
      method: 'Damped-trend exponential smoothing × day-of-week index',
      confidence,
      nObs: n,
      alpha: best.alpha,
      beta: best.beta,
      phi: PHI,
      level: best.level,
      trend: best.trend,
      dowIndices: idx,
      residualRmse: sigma,
      intervalLevel: 0.8,
      warnings,
    },
  };
}

/** Build contiguous daily series (missing day = 0 units) from sparse rows. */
export function toDailySeries(rows, start, end) {
  const byDate = new Map();
  for (const r of rows) byDate.set(r.date, (byDate.get(r.date) || 0) + Number(r.units));
  const dates = [];
  const values = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    dates.push(d);
    values.push(byDate.get(d) || 0);
  }
  return { dates, values };
}
