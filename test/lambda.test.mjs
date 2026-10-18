import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run as runForecast } from '../lambda/forecast-scheduled.mjs';
import { run as runNotify, buildDigest } from '../lambda/notify-alerts.mjs';
import { processObject } from '../lambda/import-sales.mjs';
import { explain } from '../lambda/explain-api.mjs';
import { handle as demoHandle } from '../lambda/demo-request.mjs';

const data = JSON.parse(readFileSync(new URL('../data/demo/demo.json', import.meta.url)));
const quiet = { warn() {}, error() {} };

test('forecast lambda: persists each location, isolates failures', async () => {
  const saved = [];
  const repo = {
    activeLocations: async () => [{ id: 'a' }, { id: 'bad' }, { id: 'empty' }],
    loadDataset: async (id) => { if (id === 'bad') throw new Error('boom'); return id === 'empty' ? { ...data, sales: [] } : data; },
    saveRun: async (x) => { saved.push(x); return 'run-1'; },
  };
  const out = await runForecast({ repo, today: '2026-10-09', log: quiet });
  assert.equal(saved.length, 1);
  assert.equal(Object.keys(saved[0].explanations).length, data.ingredients.length);
  assert.equal(out.find((r) => r.location === 'a').runId, 'run-1');
  assert.equal(out.find((r) => r.location === 'bad').error, 'boom');
  assert.equal(out.find((r) => r.location === 'empty').skipped, 'no-sales');
});

test('notify lambda: marks alerts only after a successful send', async () => {
  const alerts = [{ id: '1', severity: 'critical', title: 'T', detail: 'D', action: 'A' }];
  let marked = [];
  const mk = (send) => runNotify({ repo: { activeLocations: async () => [{ id: 'l', name: 'Main', notification_emails: ['a@x.com'] }, { id: 'noemail', name: 'X', notification_emails: [] }], unnotifiedAlerts: async () => alerts, markNotified: async (ids) => { marked = ids; } }, send });
  await assert.rejects(mk(async () => { throw new Error('ses down'); }));
  assert.deepEqual(marked, []);
  const out = await mk(async () => {});
  assert.deepEqual(marked, ['1']); assert.equal(out.length, 1);
  assert.match(buildDigest('Main', alerts).subject, /\[1 critical\]/);
});

test('import lambda: imports valid files, rejects invalid and oversize ones', async () => {
  const log = {};
  const repo = {
    importByKey: async () => ({ id: 'imp', location_id: 'l' }),
    menuItemsFor: async () => [{ id: 'burger', name: 'Beef Burger' }],
    upsertSales: async (x) => { log.upsert = x; },
    finishImport: async (id, status, n) => { log.status = status; log.n = n; },
  };
  assert.deepEqual(await processObject({ repo, bucket: 'b', key: 'k', size: 10, readText: async () => 'date,item,units\n2026-10-01,burger,5\n' }), { key: 'k', imported: 1 });
  assert.equal(log.status, 'imported'); assert.equal(log.upsert.rows[0].menu_item_id, 'burger');
  const bad = await processObject({ repo, bucket: 'b', key: 'k', size: 10, readText: async () => 'date,item,units\nnope,burger,5\n' });
  assert.equal(bad.rejected, true); assert.equal(log.status, 'rejected');
  assert.equal((await processObject({ repo, bucket: 'b', key: 'k', size: 6_000_000, readText: async () => '' })).rejected, true);
  assert.ok((await processObject({ repo: { ...repo, importByKey: async () => undefined }, bucket: 'b', key: 'k', size: 1, readText: async () => '' })).skipped);
});

test('explain api: validates id, caches Bedrock text but not the fallback', async () => {
  const explanation = { narrative: 'Estimate: order 5 kg.', ingredientName: 'X', unit: 'kg', asOf: 'd', recommendation: { orderQty: 5 }, steps: [], contributions: [], events: [], sensitivity: { rows: [] }, assumptions: [], flags: [] };
  const saved = [];
  const repo = { recommendation: async (id) => (id === '11111111-1111-1111-1111-111111111111' ? { explanation, narrative: null } : null), saveNarrative: async (...a) => saved.push(a) };
  assert.equal((await explain({ repo, invoke: null, id: 'x' })).statusCode, 400);
  assert.equal((await explain({ repo, invoke: null, id: '22222222-2222-2222-2222-222222222222' })).statusCode, 404);
  const id = '11111111-1111-1111-1111-111111111111';
  const fb = JSON.parse((await explain({ repo, invoke: null, id })).body);
  assert.equal(fb.source, 'deterministic'); assert.equal(saved.length, 0);
  await explain({ repo, invoke: async () => 'Estimate: order 5 kg.', id });
  assert.equal(saved.length, 1);
});

test('demo-request lambda: validates, forwards to HubSpot, hides upstream errors', async () => {
  const body = JSON.stringify({ firstname: 'A', lastname: 'B', email: 'a@b.co', company: 'C', business_type: 'caterer', location_count: 2, consent: true });
  const env = { HUBSPOT_PORTAL_ID: '1', HUBSPOT_FORM_GUID: 'g' };
  assert.equal((await demoHandle({ body: '{', env })).statusCode, 400);
  assert.equal((await demoHandle({ body: '{}', env })).statusCode, 422);
  assert.equal((await demoHandle({ body, env, fetchImpl: async () => ({ ok: true }) })).statusCode, 200);
  const r = await demoHandle({ body, env, fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.equal(r.statusCode, 502); assert.ok(!r.body.includes('500'));
});
