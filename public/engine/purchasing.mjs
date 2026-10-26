// Order-quantity recommendation for one ingredient and one supplier offer.
//
// Periodic-review logic: cover demand until the next delivery after this one
// (lead time + review period), hold safety stock, subtract usable stock, then
// respect shelf life, pack sizes and minimum order quantities.
import { daysBetween } from './dates.mjs';
import { mean, normInv, sum, Z80 } from './stats.mjs';
import { simulateStock } from './inventory.mjs';

const EPS = 1e-9;
const ceilTol = (x) => Math.ceil(x - EPS);

function demandAhead(meanArr, from, count) {
  // Beyond the forecast horizon, extend with the average of the last 7 forecast days (flat extrapolation).
  const tail = mean(meanArr.slice(-7));
  let total = 0;
  for (let i = from; i < from + count; i++) total += i < meanArr.length ? meanArr[i] : tail;
  return total;
}

/**
 * @param {object} p
 * @param {object} p.ingredient {id,name,unit,shelf_life_days,order_cycle_days,min_safety_days,max_days_cover}
 * @param {{mean:number[], sd:number[]}} p.demand forecast starting on `today`
 * @param {Array} p.lots on-hand lots   @param {Array} p.inbound open purchase orders
 * @param {object|null} p.offer {pack_size, moq_units, lead_time_days}
 * @param {object} p.settings {serviceLevel}
 */
export function recommendOrder({ ingredient, demand, lots, inbound = [], offer, settings, today }) {
  const L = offer?.lead_time_days ?? ingredient.default_lead_days ?? 2;
  const R = ingredient.order_cycle_days ?? 3;
  const W = Math.min(L + R, demand.mean.length);
  const z = normInv(settings.serviceLevel ?? 0.95);

  const D = sum(demand.mean.slice(0, W));
  const sdW = Math.sqrt(sum(demand.sd.slice(0, W).map((s) => s * s)));
  const ssStat = z * sdW;
  const avgDaily = D / Math.max(W, 1);
  const ssMin = (ingredient.min_safety_days ?? 0) * avgDaily;
  const SS = Math.max(ssStat, ssMin);

  const onHand = sum(lots.map((l) => l.qty));
  const inboundIn = sum(inbound.filter((p) => daysBetween(today, p.arrival) < W).map((p) => p.qty));
  const sim = simulateStock({ startDate: today, lots, inbound, demand: demand.mean.slice(0, W) });
  const expiring = sim.wasteQty;
  const usable = Math.max(0, onHand + inboundIn - expiring);
  const net = D + SS - usable;

  // Shelf-life / days-of-cover cap on what a new lot can usefully serve.
  const capDays = Math.max(1, Math.min(ingredient.shelf_life_days ?? 30, ingredient.max_days_cover ?? 30));
  const fullSim = simulateStock({ startDate: today, lots, inbound, demand: demand.mean });
  const stockAtArrival = L === 0 ? onHand : (fullSim.daily[Math.min(L, fullSim.daily.length) - 1]?.closing ?? 0);
  const usefulCap = Math.max(0, demandAhead(demand.mean, L, capDays) + SS - stockAtArrival);

  let raw = Math.max(0, net);
  let limitedByShelfLife = false;
  if (raw > usefulCap + EPS) {
    raw = usefulCap;
    limitedByShelfLife = true;
  }

  let packs = null;
  let orderQty = raw;
  let moqDriven = false;
  const flags = [];
  if (offer && raw > EPS) {
    const pack = offer.pack_size;
    packs = limitedByShelfLife ? Math.max(1, Math.floor(raw / pack + EPS)) : ceilTol(raw / pack);
    if (offer.moq_units && packs * pack < offer.moq_units - EPS) {
      packs = ceilTol(offer.moq_units / pack);
      moqDriven = true;
    }
    orderQty = packs * pack;
  } else if (offer) {
    packs = 0;
    orderQty = 0;
  } else if (raw > EPS) {
    flags.push('No supplier offer on file; quantity is not rounded to packs.');
  }
  if (moqDriven) flags.push('Quantity raised to meet supplier minimum order.');
  if (limitedByShelfLife) flags.push('Capped to what can be used before this delivery would expire or exceed max days of cover.');

  const highSim = simulateStock({ startDate: today, lots, inbound, demand: demand.mean.map((m, i) => demand.mean[i] + Z80 * demand.sd[i]) });
  const daysToShort = sim.firstShortDate ? daysBetween(today, sim.firstShortDate) : null;
  const daysToShortHigh = highSim.firstShortDate ? daysBetween(today, highSim.firstShortDate) : null;
  let urgency = 'ok';
  if (daysToShort !== null && daysToShort < L) urgency = 'expedite';
  else if (orderQty > EPS) urgency = 'order_today';

  const steps = [
    { key: 'demand', label: `Forecast demand, next ${W} days (${L}d lead + ${R}d review)`, value: D, effect: '+' },
    { key: 'safety', label: ssStat >= ssMin ? `Safety stock (${(settings.serviceLevel * 100).toFixed(0)}% service level, z=${z.toFixed(2)})` : `Safety stock (minimum ${ingredient.min_safety_days} days of use)`, value: SS, effect: '+' },
    { key: 'onhand', label: 'On-hand stock', value: onHand, effect: '−' },
    { key: 'expiring', label: 'Of which expected to expire before use', value: expiring, effect: '+' },
    { key: 'inbound', label: 'Inbound purchase orders in window', value: inboundIn, effect: '−' },
    { key: 'net', label: 'Net requirement', value: net, effect: '=' },
  ];
  if (limitedByShelfLife) steps.push({ key: 'cap', label: `Shelf-life / ${capDays}-day cover cap`, value: usefulCap, effect: 'cap' });
  if (offer) steps.push({ key: 'packs', label: `Rounded to ${packs} × ${offer.pack_size} ${ingredient.unit} pack${packs === 1 ? '' : 's'}${moqDriven ? ' (MOQ)' : ''}`, value: orderQty, effect: '=' });

  return {
    ingredientId: ingredient.id,
    leadDays: L,
    reviewDays: R,
    windowDays: W,
    zScore: z,
    demandWindow: D,
    demandWindowLow: Math.max(0, D - Z80 * sdW),
    demandWindowHigh: D + Z80 * sdW,
    needQty: raw,
    demandSdWindow: sdW,
    safetyStock: SS,
    safetyBasis: ssStat >= ssMin ? 'service-level' : 'minimum-days',
    onHand,
    expiringBeforeUse: expiring,
    inboundInWindow: inboundIn,
    usableStock: usable,
    netRequirement: net,
    usefulCap,
    limitedByShelfLife,
    moqDriven,
    packs,
    orderQty,
    urgency,
    daysToShortage: daysToShort,
    daysToShortageHighCase: daysToShortHigh,
    firstShortDate: sim.firstShortDate,
    flags,
    steps,
  };
}

/** What-if table: how much each input moves the recommendation. */
export function sensitivity(base) {
  const { ingredient, demand, lots, inbound, offer, settings, today } = base;
  const baseRec = recommendOrder(base);
  const scale = (f) => ({ mean: demand.mean.map((x) => x * f), sd: demand.sd.map((x) => x * f) });
  const variants = [
    { key: 'demand+10', label: 'Demand forecast 10% higher', p: { demand: scale(1.1) } },
    { key: 'demand-10', label: 'Demand forecast 10% lower', p: { demand: scale(0.9) } },
    { key: 'sl99', label: 'Service level 99%', p: { settings: { ...settings, serviceLevel: 0.99 } } },
    { key: 'sl90', label: 'Service level 90%', p: { settings: { ...settings, serviceLevel: 0.9 } } },
    { key: 'lead+1', label: 'Supplier lead time +1 day', p: { offer: offer ? { ...offer, lead_time_days: offer.lead_time_days + 1 } : offer, ingredient: offer ? ingredient : { ...ingredient, default_lead_days: (ingredient.default_lead_days ?? 2) + 1 } } },
    { key: 'stock-20', label: 'Stock count 20% lower', p: { lots: lots.map((l) => ({ ...l, qty: l.qty * 0.8 })) } },
    { key: 'stock+20', label: 'Stock count 20% higher', p: { lots: lots.map((l) => ({ ...l, qty: l.qty * 1.2 })) } },
  ];
  return {
    base: { netRequirement: baseRec.netRequirement, orderQty: baseRec.orderQty },
    rows: variants.map((v) => {
      const r = recommendOrder({ ...base, ...v.p });
      return {
        key: v.key,
        label: v.label,
        netRequirement: r.netRequirement,
        orderQty: r.orderQty,
        deltaNet: r.netRequirement - baseRec.netRequirement,
        deltaOrder: r.orderQty - baseRec.orderQty,
      };
    }),
  };
}
