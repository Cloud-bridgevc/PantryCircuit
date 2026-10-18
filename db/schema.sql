-- PantryCircuit PostgreSQL schema (PostgreSQL 14+; validated on 14.20).
-- Multi-tenant: every business table carries organization_id; location_id scopes operational data.
-- Quantities are stored in each ingredient's purchase unit (kg, L, each).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  currency      char(3) NOT NULL DEFAULT 'USD',
  hubspot_company_id text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  timezone        text NOT NULL DEFAULT 'UTC',
  notification_emails text[] NOT NULL DEFAULT '{}',
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- serviceLevel, demandCorrelation, ... (see engine DEFAULT_SETTINGS)
  active          boolean NOT NULL DEFAULT true,
  UNIQUE (organization_id, name)
);

CREATE TABLE ingredients (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code             text NOT NULL,
  name             text NOT NULL,
  unit             text NOT NULL CHECK (unit IN ('kg','g','L','mL','each')),
  category         text,
  shelf_life_days  integer NOT NULL CHECK (shelf_life_days > 0),
  yield_pct        numeric(4,3) NOT NULL DEFAULT 1 CHECK (yield_pct > 0 AND yield_pct <= 1),
  order_cycle_days integer NOT NULL DEFAULT 3 CHECK (order_cycle_days > 0),
  min_safety_days  numeric(4,1) NOT NULL DEFAULT 0 CHECK (min_safety_days >= 0),
  max_days_cover   integer NOT NULL DEFAULT 30 CHECK (max_days_cover > 0),
  UNIQUE (organization_id, code)
);

CREATE TABLE ingredient_lots (            -- physical stock counts, FEFO
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id    uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  ingredient_id  uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  lot_code       text NOT NULL,
  qty            numeric(12,3) NOT NULL CHECK (qty >= 0),
  received_date  date NOT NULL,
  expiry_date    date NOT NULL,           -- last usable day
  counted_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (expiry_date >= received_date),
  UNIQUE (location_id, ingredient_id, lot_code)
);
CREATE INDEX ON ingredient_lots (location_id, ingredient_id) WHERE qty > 0;

CREATE TABLE menu_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  category        text,
  price           numeric(10,2) CHECK (price >= 0),
  closed_dows     smallint[] NOT NULL DEFAULT '{}',
  active          boolean NOT NULL DEFAULT true,
  UNIQUE (organization_id, code)
);

CREATE TABLE recipe_lines (
  menu_item_id   uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  ingredient_id  uuid NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  qty_per_portion numeric(10,4) NOT NULL CHECK (qty_per_portion > 0),
  PRIMARY KEY (menu_item_id, ingredient_id)
);

CREATE TABLE sales_daily (
  location_id   uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  menu_item_id  uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  sale_date     date NOT NULL,
  units_sold    integer NOT NULL CHECK (units_sold >= 0),
  import_id     uuid,
  PRIMARY KEY (location_id, menu_item_id, sale_date)
);
CREATE INDEX ON sales_daily (location_id, sale_date);

CREATE TABLE import_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  s3_bucket     text NOT NULL,
  s3_key        text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','imported','rejected')),
  rows_imported integer,
  errors        jsonb NOT NULL DEFAULT '[]'::jsonb,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (s3_bucket, s3_key)
);
ALTER TABLE sales_daily ADD FOREIGN KEY (import_id) REFERENCES import_files(id) ON DELETE SET NULL;

CREATE TABLE planned_events (            -- known demand changes (catering orders, private hires)
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  menu_item_id  uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  event_date    date NOT NULL,
  extra_units   integer NOT NULL CHECK (extra_units >= 0),
  note          text
);

CREATE TABLE seasonal_factors (          -- user-entered assumptions, not learned
  menu_item_id  uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  month         smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  multiplier    numeric(5,3) NOT NULL CHECK (multiplier > 0),
  source        text NOT NULL,
  PRIMARY KEY (menu_item_id, month)
);

CREATE TABLE suppliers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                text NOT NULL,
  delivery_fee        numeric(10,2) NOT NULL DEFAULT 0,
  free_delivery_over  numeric(10,2),
  min_order_value     numeric(10,2) NOT NULL DEFAULT 0,
  notes               text,
  hubspot_company_id  text
);

CREATE TABLE supplier_offers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id    uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  ingredient_id  uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  pack_size      numeric(10,3) NOT NULL CHECK (pack_size > 0),
  pack_price     numeric(10,2) NOT NULL CHECK (pack_price >= 0),
  moq_units      numeric(10,3) NOT NULL DEFAULT 0,
  lead_time_days integer NOT NULL CHECK (lead_time_days >= 0),
  valid_from     date NOT NULL DEFAULT current_date,
  valid_to       date,
  UNIQUE (supplier_id, ingredient_id, valid_from)
);

CREATE TABLE inbound_orders (            -- open purchase orders
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id    uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  ingredient_id  uuid NOT NULL REFERENCES ingredients(id),
  supplier_id    uuid REFERENCES suppliers(id),
  po_ref         text NOT NULL,
  qty            numeric(12,3) NOT NULL CHECK (qty > 0),
  arrival_date   date NOT NULL,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','received','cancelled')),
  UNIQUE (location_id, po_ref, ingredient_id)
);

-- Forecast outputs ---------------------------------------------------------
CREATE TABLE forecast_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id   uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  as_of_date    date NOT NULL,
  engine_version text NOT NULL,
  settings      jsonb NOT NULL,           -- exact settings used, for reproducibility
  history_through date NOT NULL,
  accuracy      jsonb,                    -- backtest summary
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, as_of_date, engine_version)
);

CREATE TABLE item_forecasts (
  run_id        uuid NOT NULL REFERENCES forecast_runs(id) ON DELETE CASCADE,
  menu_item_id  uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  forecast_date date NOT NULL,
  point         numeric(10,2) NOT NULL,
  low80         numeric(10,2) NOT NULL,
  high80        numeric(10,2) NOT NULL,
  components    jsonb NOT NULL,
  PRIMARY KEY (run_id, menu_item_id, forecast_date)
);

CREATE TABLE purchase_recommendations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid NOT NULL REFERENCES forecast_runs(id) ON DELETE CASCADE,
  ingredient_id  uuid NOT NULL REFERENCES ingredients(id),
  supplier_id    uuid REFERENCES suppliers(id),
  order_qty      numeric(12,3) NOT NULL CHECK (order_qty >= 0),
  packs          integer,
  est_goods_cost numeric(12,2),
  urgency        text NOT NULL CHECK (urgency IN ('ok','order_today','expedite')),
  explanation    jsonb NOT NULL,          -- steps, contributions, sensitivity, assumptions (input to Bedrock)
  narrative      text,                    -- cached Bedrock text, null until generated
  UNIQUE (run_id, ingredient_id)
);

CREATE TABLE alerts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid NOT NULL REFERENCES forecast_runs(id) ON DELETE CASCADE,
  location_id    uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  ingredient_id  uuid NOT NULL REFERENCES ingredients(id),
  type           text NOT NULL CHECK (type IN ('shortage','waste','overstock')),
  severity       text NOT NULL CHECK (severity IN ('critical','warning','info')),
  title          text NOT NULL,
  detail         text NOT NULL,
  action         text NOT NULL,
  metrics        jsonb NOT NULL DEFAULT '{}'::jsonb,
  notified_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, type, ingredient_id)
);
CREATE INDEX ON alerts (location_id, created_at DESC) WHERE notified_at IS NULL;

-- Latest stock per ingredient/location convenience view
CREATE VIEW stock_on_hand AS
  SELECT location_id, ingredient_id, sum(qty) AS qty, min(expiry_date) FILTER (WHERE qty > 0) AS earliest_expiry
  FROM ingredient_lots GROUP BY location_id, ingredient_id;
