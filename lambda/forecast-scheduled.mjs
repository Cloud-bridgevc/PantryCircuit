// EventBridge schedule (daily, before service). For each active location: load data,
// run the numerical plan, persist forecasts/recommendations/alerts.
import { runPlan, explainRecommendation } from '../src/engine/index.mjs';
import { createRepo, getDb } from './repo.mjs';

export async function run({ repo, today, log = console }) {
  const results = [];
  for (const loc of await repo.activeLocations()) {
    try {
      const data = await repo.loadDataset(loc.id, today);
      if (!data.sales.length) { log.warn(`location ${loc.id}: no sales history, skipped`); results.push({ location: loc.id, skipped: 'no-sales' }); continue; }
      const plan = runPlan(data);
      const explanations = Object.fromEntries(data.ingredients.map((i) => [i.id, explainRecommendation(plan, data, i.id)]));
      const runId = await repo.saveRun({ locationId: loc.id, plan, explanations });
      results.push({ location: loc.id, runId, alerts: plan.alerts.length });
    } catch (err) {
      log.error(`location ${loc.id} failed: ${err.message}`);   // one failing location must not block the rest
      results.push({ location: loc.id, error: err.message });
    }
  }
  return results;
}

export const handler = async (event = {}) => {
  const today = event.asOf || new Date().toISOString().slice(0, 10);
  const results = await run({ repo: createRepo(await getDb()), today });
  if (results.some((r) => r.error)) throw new Error(`Forecast failed for ${results.filter((r) => r.error).length} location(s)`);
  return results;
};
