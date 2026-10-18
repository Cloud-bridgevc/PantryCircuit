# PantryCircuit

Inventory forecasting and purchasing recommendations for restaurants, caterers and commercial kitchens. **Forecasts are estimates**, shown with their inputs, assumptions and ranges. The project makes no waste-reduction or savings claims.

## Run it
```bash
npm start            # http://localhost:4173  (site)  ·  /app/  (dashboard)
npm test             # 39 tests: forecasting, purchasing, suppliers, CSV, Bedrock guardrails, Lambdas
npm run demo         # plan printed in the terminal;  npm run demo chicken_thigh  for one explanation
npm run demo-data    # regenerate the fictional data (seeded, deterministic)
```
Requires Node 20+. No install step: the app has no runtime dependencies. (`lambda/package.json` lists AWS SDK/pg for deployment only.)

## What's here
| Path | What |
|---|---|
| `web/index.html` | Public site: features, use cases, pricing (illustrative), purchasing calculator, demo-request form |
| `web/app/` | Dashboard: overview, purchase orders (with "why" panel and what-ifs), alerts, inventory, forecast, recipes/menu, suppliers, sales CSV import, accuracy, assumptions |
| `src/engine/` | The numerical engine, shared by browser and Lambda |
| `src/ai/bedrock.mjs` | Bedrock explanations with number verification and deterministic fallback |
| `src/crm/demoRequest.mjs` | Form validation and HubSpot Forms API mapping |
| `lambda/` | Scheduled forecast, alert digest, S3 sales import, explain API, demo-request API |
| `db/schema.sql` | PostgreSQL schema |
| `infra/template.yaml` | AWS SAM template (RDS, S3, Lambda, EventBridge, HTTP API) |
| `docs/` | `forecasting-method.md`, `architecture.md`, `hubspot-crm-plan.md` |
| `data/demo/` | Fictional sales history (84 days × 8 dishes), recipes, stock, suppliers, offers |

## Demonstration: one recommendation, input by input
Fictional kitchen, planned for 2026-10-09. For **chicken thighs**: forecast demand over the next 3 days (1-day lead + 2-day order cycle, including a confirmed 60-guest Sunday catering order) is 63.0 kg (80% range 57.8–68.3). Add 10.5 kg safety stock, subtract 24.0 kg on hand: net need 49.6 kg, rounded to **5 × 10 kg = 50 kg**.

How inputs move it (net requirement, `npm run demo chicken_thigh`): demand ±10% → ±7.4 kg; lead time +1 day → +7.1 kg; stock count ±20% → ∓4.8 kg. Service level makes no difference here because the minimum-safety-days rule is the one binding. The dashboard shows this live, and lets you edit stock counts, recipes and settings.

## Honest status
- Verified: unit/integration tests pass; schema applies on PostgreSQL 14.20; `infra/template.yaml` passes cfn-lint; dashboard and site loaded in a browser with no console errors across all views.
- **Not verified:** nothing has been deployed to AWS; Bedrock and SES calls have only been exercised with fakes (set `BEDROCK_MODEL_ID` to a model you have access to); the HubSpot submission is tested with a fake `fetch` and needs your portal ID and form GUID. Without those, the dev server saves demo requests to `.local/demo-requests.jsonl`.
- The dashboard demo runs entirely in the browser; there is no authentication or server API yet (see `docs/architecture.md`, "Not built yet").
- Backtest accuracy on the fictional data (dish-level WAPE about 21%) says nothing about real kitchens.
