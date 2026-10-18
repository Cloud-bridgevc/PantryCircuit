// PostgreSQL access. Maps database rows to the engine's dataset shape (ingredient and
// menu-item `code` columns become the engine ids) and persists run outputs.
export const ENGINE_VERSION = '0.1.0';
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

export function createRepo(db) {
  const q = async (text, params) => (await db.query(text, params)).rows;
  return {
    async activeLocations() {
      return q('SELECT id, organization_id, name, settings, notification_emails FROM locations WHERE active');
    },

    async loadDataset(locationId, asOf, historyDays = 180) {
      const [loc] = await q('SELECT l.id, l.name, l.settings, o.id AS org_id, o.name AS org, o.currency FROM locations l JOIN organizations o ON o.id = l.organization_id WHERE l.id = $1', [locationId]);
      if (!loc) throw new Error(`Unknown location ${locationId}`);
      const org = loc.org_id;
      const [items, ings, lines, sales, lots, inbound, sups, offers, events, seasonal] = await Promise.all([
        q('SELECT code, name, price::float, category, closed_dows FROM menu_items WHERE organization_id=$1 AND active', [org]),
        q('SELECT code, name, unit, category, shelf_life_days, yield_pct::float, order_cycle_days, min_safety_days::float, max_days_cover FROM ingredients WHERE organization_id=$1', [org]),
        q('SELECT m.code AS item, i.code AS ing, r.qty_per_portion::float AS qty FROM recipe_lines r JOIN menu_items m ON m.id=r.menu_item_id JOIN ingredients i ON i.id=r.ingredient_id WHERE m.organization_id=$1', [org]),
        q(`SELECT s.sale_date, m.code AS item, s.units_sold FROM sales_daily s JOIN menu_items m ON m.id=s.menu_item_id WHERE s.location_id=$1 AND s.sale_date >= ($2::date - $3::int) AND s.sale_date < $2::date`, [locationId, asOf, historyDays]),
        q('SELECT i.code AS ing, l.lot_code, l.qty::float, l.received_date, l.expiry_date FROM ingredient_lots l JOIN ingredients i ON i.id=l.ingredient_id WHERE l.location_id=$1 AND l.qty>0', [locationId]),
        q(`SELECT i.code AS ing, b.po_ref, b.qty::float, b.arrival_date FROM inbound_orders b JOIN ingredients i ON i.id=b.ingredient_id WHERE b.location_id=$1 AND b.status='open' AND b.arrival_date >= $2::date`, [locationId, asOf]),
        q('SELECT id::text, name, delivery_fee::float, free_delivery_over::float, min_order_value::float, notes FROM suppliers WHERE organization_id=$1', [org]),
        q(`SELECT o.supplier_id::text AS supplier_id, i.code AS ing, o.pack_size::float, o.pack_price::float, o.moq_units::float, o.lead_time_days FROM supplier_offers o JOIN suppliers s ON s.id=o.supplier_id JOIN ingredients i ON i.id=o.ingredient_id WHERE s.organization_id=$1 AND o.valid_from <= $2::date AND (o.valid_to IS NULL OR o.valid_to >= $2::date)`, [org, asOf]),
        q('SELECT e.event_date, m.code AS item, e.extra_units, e.note FROM planned_events e JOIN menu_items m ON m.id=e.menu_item_id WHERE e.location_id=$1 AND e.event_date >= $2::date', [locationId, asOf]),
        q('SELECT m.code AS item, f.month, f.multiplier::float, f.source FROM seasonal_factors f JOIN menu_items m ON m.id=f.menu_item_id WHERE m.organization_id=$1', [org]),
      ]);
      const recipes = [...new Set(lines.map((l) => l.item))].map((item) => ({ menu_item_id: item, lines: lines.filter((l) => l.item === item).map((l) => ({ ingredient_id: l.ing, qty: l.qty })) }));
      return {
        meta: { org: loc.org, location: loc.name, currency: loc.currency, asOf: iso(asOf) },
        settings: loc.settings || {},
        menuItems: items.map((m) => ({ id: m.code, name: m.name, price: m.price, category: m.category, closed_dows: m.closed_dows })),
        ingredients: ings.map((i) => ({ id: i.code, ...i, code: undefined })),
        recipes,
        sales: sales.map((s) => ({ date: iso(s.sale_date), menu_item_id: s.item, units: s.units_sold })),
        stock: lots.map((l) => ({ ingredient_id: l.ing, lot_id: l.lot_code, qty: l.qty, received_date: iso(l.received_date), expiry_date: iso(l.expiry_date) })),
        inbound: inbound.map((b) => ({ ingredient_id: b.ing, po_ref: b.po_ref, qty: b.qty, arrival_date: iso(b.arrival_date) })),
        suppliers: sups,
        offers: offers.map((o) => ({ supplier_id: o.supplier_id, ingredient_id: o.ing, pack_size: o.pack_size, pack_price: o.pack_price, moq_units: o.moq_units, lead_time_days: o.lead_time_days })),
        events: events.map((e) => ({ date: iso(e.event_date), menu_item_id: e.item, extra_units: e.extra_units, note: e.note })),
        seasonal: seasonal.map((s) => ({ menu_item_id: s.item, month: s.month, multiplier: s.multiplier, source: s.source })),
      };
    },

    /** Persist one run atomically; re-running the same day/version replaces the previous run. */
    async saveRun({ locationId, plan, explanations }) {
      await db.query('BEGIN');
      try {
        await db.query('DELETE FROM forecast_runs WHERE location_id=$1 AND as_of_date=$2 AND engine_version=$3', [locationId, plan.today, ENGINE_VERSION]);
        const [{ id: runId }] = await q('INSERT INTO forecast_runs (location_id, as_of_date, engine_version, settings, history_through, accuracy) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [locationId, plan.today, ENGINE_VERSION, plan.settings, plan.histEnd, { overall: plan.accuracy.overall && { wape: plan.accuracy.overall.wape, bias: plan.accuracy.overall.bias, coverage80: plan.accuracy.overall.coverage80, baselineSeasonalNaiveWape: plan.accuracy.overall.baselineSeasonalNaiveWape } }]);
        const items = await q('SELECT m.code, m.id FROM menu_items m JOIN locations l ON l.organization_id=m.organization_id WHERE l.id=$1', [locationId]);
        const ings = await q('SELECT i.code, i.id FROM ingredients i JOIN locations l ON l.organization_id=i.organization_id WHERE l.id=$1', [locationId]);
        const itemId = Object.fromEntries(items.map((r) => [r.code, r.id]));
        const ingId = Object.fromEntries(ings.map((r) => [r.code, r.id]));
        for (const [code, fc] of Object.entries(plan.forecasts)) {
          for (const p of fc.points) await db.query('INSERT INTO item_forecasts VALUES ($1,$2,$3,$4,$5,$6,$7)', [runId, itemId[code], p.date, p.point, p.low, p.high, p.components]);
        }
        for (const r of plan.recommendations) {
          await db.query('INSERT INTO purchase_recommendations (run_id, ingredient_id, supplier_id, order_qty, packs, est_goods_cost, urgency, explanation) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [runId, ingId[r.ingredientId], r.supplier?.id ?? null, r.rec.orderQty, r.rec.packs, r.cost || null, r.rec.urgency, explanations[r.ingredientId]]);
        }
        for (const a of plan.alerts) {
          await db.query('INSERT INTO alerts (run_id, location_id, ingredient_id, type, severity, title, detail, action, metrics) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (run_id, type, ingredient_id) DO NOTHING', [runId, locationId, ingId[a.ingredientId], a.type, a.severity, a.title, a.detail, a.action, a.metrics]);
        }
        await db.query('COMMIT');
        return runId;
      } catch (e) { await db.query('ROLLBACK'); throw e; }
    },

    async unnotifiedAlerts(locationId) {
      return q(`SELECT a.id, a.severity, a.type, a.title, a.detail, a.action FROM alerts a WHERE a.location_id=$1 AND a.notified_at IS NULL AND a.severity IN ('critical','warning') AND a.created_at > now() - interval '1 day' ORDER BY a.severity, a.created_at`, [locationId]);
    },
    async markNotified(ids) { if (ids.length) await db.query('UPDATE alerts SET notified_at = now() WHERE id = ANY($1::uuid[])', [ids]); },

    async upsertSales({ locationId, importId, rows }) {
      const items = await q('SELECT m.code, m.id FROM menu_items m JOIN locations l ON l.organization_id=m.organization_id WHERE l.id=$1', [locationId]);
      const id = Object.fromEntries(items.map((r) => [r.code, r.id]));
      await db.query('BEGIN');
      try {
        for (const r of rows) await db.query('INSERT INTO sales_daily (location_id, menu_item_id, sale_date, units_sold, import_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (location_id, menu_item_id, sale_date) DO UPDATE SET units_sold=EXCLUDED.units_sold, import_id=EXCLUDED.import_id', [locationId, id[r.menu_item_id], r.date, r.units, importId]);
        await db.query('COMMIT');
      } catch (e) { await db.query('ROLLBACK'); throw e; }
    },
    menuItemsFor: (locationId) => q('SELECT m.code AS id, m.name FROM menu_items m JOIN locations l ON l.organization_id=m.organization_id WHERE l.id=$1', [locationId]),
    importByKey: (bucket, key) => q('SELECT id, location_id FROM import_files WHERE s3_bucket=$1 AND s3_key=$2', [bucket, key]).then((r) => r[0]),
    finishImport: (id, status, rows, errors) => db.query('UPDATE import_files SET status=$2, rows_imported=$3, errors=$4 WHERE id=$1', [id, status, rows, JSON.stringify(errors)]),
    recommendation: (id) => q('SELECT r.id, r.explanation, r.narrative, r.run_id FROM purchase_recommendations r WHERE r.id=$1', [id]).then((r) => r[0]),
    saveNarrative: (id, text) => db.query('UPDATE purchase_recommendations SET narrative=$2 WHERE id=$1', [id, text]),
  };
}

let pool;
/** Lazily creates a pg Pool. Credentials come from the RDS-managed Secrets Manager secret. */
export async function getDb() {
  if (pool) return pool;
  const { default: pg } = await import('pg');
  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
  const sm = new SecretsManagerClient({});
  const { SecretString } = await sm.send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }));
  const s = JSON.parse(SecretString);
  pool = new pg.Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME || 'pantrycircuit', user: s.username, password: s.password, ssl: { rejectUnauthorized: false }, max: 2 });
  return pool;
}
