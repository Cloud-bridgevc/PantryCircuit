// Supplier comparison on landed cost, including shared delivery fees.

/** Cost of buying `qtyNeeded` of an ingredient from one offer (delivery fee excluded). */
export function priceOffer(offer, qtyNeeded, ingredient) {
  const pack = offer.pack_size;
  let packs = Math.max(1, Math.ceil(qtyNeeded / pack - 1e-9));
  if (offer.moq_units) packs = Math.max(packs, Math.ceil(offer.moq_units / pack - 1e-9));
  const qty = packs * pack;
  const goods = packs * offer.pack_price;
  return {
    offer,
    packs,
    qty,
    excess: qty - qtyNeeded,
    goods,
    unitCost: goods / qty,
    moqDriven: !!offer.moq_units && Math.ceil(qtyNeeded / pack - 1e-9) * pack < offer.moq_units,
    unit: ingredient?.unit,
  };
}

/** Single-ingredient comparison, ranked: feasible first, then total cost for the quantity needed. */
export function compareOffers({ ingredient, qtyNeeded, offers, suppliers, daysToShortage }) {
  const supById = Object.fromEntries(suppliers.map((s) => [s.id, s]));
  const rows = offers
    .filter((o) => o.ingredient_id === ingredient.id)
    .map((o) => {
      const priced = priceOffer(o, qtyNeeded, ingredient);
      const s = supById[o.supplier_id];
      const feasible = daysToShortage == null || o.lead_time_days <= daysToShortage;
      const freeOver = s.free_delivery_over ?? Infinity;
      const fee = priced.goods >= freeOver ? 0 : s.delivery_fee;
      return { ...priced, supplier: s, feasible, deliveryFee: fee, landed: priced.goods + fee, landedPerNeeded: (priced.goods + fee) / qtyNeeded };
    });
  rows.sort((a, b) => Number(b.feasible) - Number(a.feasible) || a.landed - b.landed);
  return rows;
}

/**
 * Choose one supplier per ingredient to minimise total cost across the basket,
 * accounting for per-supplier delivery fees and minimum order values.
 * candidates: [{ ingredientId, options:[{offer, qty, goods, feasible}] }]
 * Coordinate descent from the cheapest-goods start; deterministic.
 */
export function optimizeBasket(candidates, suppliers) {
  const supById = Object.fromEntries(suppliers.map((s) => [s.id, s]));
  const choice = new Map();
  for (const c of candidates) {
    const pool = c.options.some((o) => o.feasible) ? c.options.filter((o) => o.feasible) : c.options;
    choice.set(c.ingredientId, pool.reduce((best, o) => (o.goods < best.goods ? o : best)));
  }
  const totals = () => {
    const bySup = new Map();
    for (const o of choice.values()) bySup.set(o.offer.supplier_id, (bySup.get(o.offer.supplier_id) || 0) + o.goods);
    let cost = 0;
    const detail = [];
    for (const [sid, goods] of bySup) {
      const s = supById[sid];
      const fee = goods >= (s.free_delivery_over ?? Infinity) ? 0 : s.delivery_fee;
      const shortfall = Math.max(0, (s.min_order_value ?? 0) - goods);
      cost += goods + fee + shortfall * 2; // below-minimum carts are penalised so the search avoids them
      detail.push({ supplier: s, goods, fee, belowMinimum: shortfall > 0, minShortfall: shortfall });
    }
    return { cost, detail };
  };
  let best = totals().cost;
  for (let pass = 0; pass < 10; pass++) {
    let improved = false;
    for (const c of candidates) {
      const pool = c.options.some((o) => o.feasible) ? c.options.filter((o) => o.feasible) : c.options;
      const current = choice.get(c.ingredientId);
      for (const opt of pool) {
        if (opt === current) continue;
        choice.set(c.ingredientId, opt);
        const t = totals().cost;
        if (t < best - 1e-9) {
          best = t;
          improved = true;
          break;
        }
        choice.set(c.ingredientId, current);
      }
    }
    if (!improved) break;
  }
  const { cost, detail } = totals();
  const lines = candidates.map((c) => ({ ingredientId: c.ingredientId, ...choice.get(c.ingredientId) }));
  return { lines, bySupplier: detail, totalGoods: lines.reduce((s, l) => s + l.goods, 0), totalCost: detail.reduce((s, d) => s + d.goods + d.fee, 0), objective: cost };
}
