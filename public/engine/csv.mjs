// Minimal RFC-4180-style CSV parser and the sales-history importer's validation.
import { isIsoDate } from './dates.mjs';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const ALIASES = {
  date: ['date', 'sale_date', 'day'],
  item: ['menu_item_id', 'menu_item', 'item', 'item_name', 'dish', 'name'],
  units: ['units_sold', 'units', 'quantity', 'qty', 'sold'],
};

/** Validate and normalise a sales-history CSV against the known menu. */
export function parseSalesCsv(text, menuItems, { maxRows = 200000, maxUnits = 100000 } = {}) {
  const table = parseCsv(text);
  const errors = [];
  const warnings = [];
  if (table.length < 2) return { rows: [], errors: ['File has no data rows.'], warnings };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(Object.entries(ALIASES).map(([k, names]) => [k, header.findIndex((h) => names.includes(h))]));
  for (const [k, i] of Object.entries(col)) if (i < 0) errors.push(`Missing column for "${k}" (accepted headers: ${ALIASES[k].join(', ')}).`);
  if (errors.length) return { rows: [], errors, warnings };
  if (table.length - 1 > maxRows) return { rows: [], errors: [`Too many rows (limit ${maxRows}).`], warnings };

  const lookup = new Map();
  for (const m of menuItems) { lookup.set(m.id.toLowerCase(), m.id); lookup.set(m.name.toLowerCase(), m.id); }
  const seen = new Map();
  const unknown = new Set();
  for (let r = 1; r < table.length; r++) {
    const line = r + 1;
    const date = (table[r][col.date] || '').trim();
    const itemRaw = (table[r][col.item] || '').trim();
    const unitsRaw = (table[r][col.units] || '').trim();
    if (!isIsoDate(date)) { errors.push(`Line ${line}: "${date}" is not a valid YYYY-MM-DD date.`); continue; }
    const id = lookup.get(itemRaw.toLowerCase());
    if (!id) { unknown.add(itemRaw); continue; }
    const units = Number(unitsRaw);
    if (unitsRaw === '' || !Number.isFinite(units) || units < 0 || units > maxUnits || !Number.isInteger(units)) {
      errors.push(`Line ${line}: units "${unitsRaw}" must be a whole number between 0 and ${maxUnits}.`);
      continue;
    }
    const key = `${date}|${id}`;
    if (seen.has(key)) warnings.push(`Line ${line}: duplicate ${date} / ${id}; later value used.`);
    seen.set(key, { date, menu_item_id: id, units });
  }
  if (unknown.size) warnings.push(`Skipped ${unknown.size} unknown menu item name(s): ${[...unknown].slice(0, 5).join(', ')}${unknown.size > 5 ? '…' : ''}. Add them under Menu first.`);
  const rows = [...seen.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.menu_item_id < b.menu_item_id ? -1 : 1));
  if (rows.length) {
    const dates = rows.map((x) => x.date);
    warnings.push(`Parsed ${rows.length} rows covering ${dates[0]} to ${dates[dates.length - 1]}.`);
  }
  return { rows, errors, warnings };
}
