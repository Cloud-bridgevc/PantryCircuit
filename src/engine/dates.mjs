// Calendar-day helpers. Dates are ISO strings (YYYY-MM-DD) handled in UTC so
// results never depend on the machine's timezone or DST.
const DAY_MS = 86400000;

export const parseDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const fmtDate = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso, n) => fmtDate(parseDate(iso) + n * DAY_MS);
export const dayOfWeek = (iso) => new Date(parseDate(iso)).getUTCDay(); // 0 = Sunday
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
export const dateRange = (start, n) => Array.from({ length: n }, (_, i) => addDays(start, i));
export const monthOf = (iso) => Number(iso.slice(5, 7));
export const isIsoDate = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmtDate(parseDate(s)) === s;
export const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
