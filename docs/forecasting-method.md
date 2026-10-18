# Forecasting method, assumptions and limits

All quantities come from deterministic code in `src/engine/`. Language models never produce numbers.

## 1. Dish demand (`forecast.mjs`)
For each menu item, from daily units sold:
1. **Weekday indices** from the last N weeks (default 8): mean units per weekday ÷ overall mean; fewer than 4 observations of a weekday shrinks its index toward 1.
2. **De-seasonalise** the history by those indices.
3. **Damped-trend exponential smoothing (Holt)** on the de-seasonalised series; damping φ = 0.9. Smoothing parameters α ∈ {0.05…0.4} and β ∈ {0, 0.02, 0.05} are chosen by minimising one-step-ahead squared error on the item's own history (after a 14-day warm-up).
4. **Forecast** = level + damped trend × weekday index × seasonal multiplier + known events.
5. **80% interval** from the in-sample RMSE, scaled by √(weekday index) (variance grows with volume) and widened with horizon.

Histories under 28 days use fixed parameters and are labelled low confidence.

## 2. Ingredient demand (`inventory.mjs`)
`ingredient qty = Σ dishes (forecast portions × recipe qty ÷ usable yield)`. Ranges combine dish uncertainty assuming a **partial correlation ρ = 0.3** between dishes (configurable; an assumption, not measured).

## 3. Stock simulation
Day-by-day first-expired-first-out simulation under three demand cases: central, low (10th percentile), high (90th). It produces projected stock-outs, expiring quantities, and days of cover.

## 4. Purchase quantity (`purchasing.mjs`)
```
window W      = supplier lead time + days between orders
demand D      = Σ central forecast over W
safety stock  = max( z(service level) × √Σ daily σ², minimum safety days × avg daily use )
usable stock  = on hand + inbound in window − stock that expires before use
net need      = D + safety stock − usable stock
```
Then capped to what a new delivery can use before its shelf life or max days of cover, rounded up to whole packs, and raised to the supplier's minimum order if needed. Every step is shown in the UI.

## 5. Supplier choice (`suppliers.mjs`)
Per ingredient, each supplier's offer produces its own quantity (lead time changes W). The basket optimiser picks one offer per ingredient to minimise total goods + delivery fees (free-delivery thresholds, minimum order values), preferring offers that arrive before projected stock-out. It is a deterministic coordinate-descent search, not a guaranteed global optimum.

## 6. Accuracy (`accuracy.mjs`)
Rolling-origin backtest over the last 4 weeks: each week is forecast using only earlier data, then compared with actual sales. Reported: WAPE, bias, 80%-interval coverage, and two naive baselines (same weekday last week; trailing 7-day mean). On the fictional demo data the dish-level WAPE is about 21%. Daily per-dish error is naturally larger than weekly or ingredient-level error.

## 7. What it assumes and cannot know
- Sales equal demand: days when an item sold out understate demand.
- Seasonal multipliers and events are user inputs; with under a year of history, annual seasonality cannot be learned.
- Weather, promotions, local events and competitor activity are not modelled unless entered as events.
- Stock counts, recipe quantities, yields, lead times and prices are as entered; supplier delivery performance is not measured.
- Forecast errors are treated as independent day to day, which understates risk when the level shifts; minimum safety days and a higher service level compensate.

## 8. Claims policy
PantryCircuit makes no waste-reduction or savings claims without evidence measured in a customer's own kitchen (e.g. before/after waste logs). The demo and website state this.
