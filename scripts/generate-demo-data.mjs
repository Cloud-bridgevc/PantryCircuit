// Generates data/demo/{sales_history.csv,demo.json}. Deterministic (seeded).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, dayOfWeek } from '../src/engine/dates.mjs';
import * as C from './demo-config.mjs';

const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rng = mulberry32(20261009);
const normal = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

const sales = [];
for (const item of C.MENU) {
  for (let i = 0; i < C.HISTORY_DAYS; i++) {
    const date = addDays(C.HISTORY_START, i);
    const week = i / 7;
    const mean = item.base * C.DOW_PATTERN[dayOfWeek(date)] * (1 + item.trendPerWeek * week) * (C.ONE_OFFS[date] || 1);
    const units = Math.max(0, Math.round(mean + normal() * Math.sqrt(mean) * 1.15));
    sales.push({ date, menu_item_id: item.id, units });
  }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'demo');
mkdirSync(root, { recursive: true });
const names = Object.fromEntries(C.MENU.map((m) => [m.id, m.name]));
writeFileSync(join(root, 'sales_history.csv'), 'date,menu_item_id,units_sold\n' + sales.map((s) => `${s.date},${s.menu_item_id},${s.units}`).join('\n') + '\n');

const data = {
  meta: C.META,
  settings: {},
  menuItems: C.MENU.map(({ id, name, price, category }) => ({ id, name, price, category })),
  ingredients: C.INGREDIENTS,
  recipes: C.RECIPES,
  sales,
  stock: C.STOCK,
  inbound: C.INBOUND,
  suppliers: C.SUPPLIERS,
  offers: C.OFFERS,
  events: C.EVENTS,
  seasonal: C.SEASONAL,
};
writeFileSync(join(root, 'demo.json'), JSON.stringify(data));
// A small CSV for trying the import flow (a few extra days beyond the history).
writeFileSync(join(root, 'sample_import.csv'), 'date,item,units\n' + ['2026-10-09'].flatMap((d) => C.MENU.map((m) => `${d},${m.name},${Math.round(m.base * C.DOW_PATTERN[dayOfWeek(d)])}`)).join('\n') + '\n');
console.log(`Wrote ${sales.length} sales rows, ${C.INGREDIENTS.length} ingredients, ${C.OFFERS.length} supplier offers.`);
