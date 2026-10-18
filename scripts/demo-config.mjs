// Fictional kitchen used for the demo. Nothing here is real customer data.
export const META = {
  org: 'Harbour & Vine Kitchen (fictional)',
  location: 'Demo Location – Main Kitchen',
  currency: 'USD',
  asOf: '2026-10-09',
  note: 'All records are fictional and generated for demonstration. Forecasts are estimates.',
};

export const MENU = [
  { id: 'chicken', name: 'Roast Chicken Plate', price: 21.5, category: 'Mains', base: 34, trendPerWeek: 0.002 },
  { id: 'risotto', name: 'Mushroom Risotto', price: 18, category: 'Mains', base: 22, trendPerWeek: 0.012 },
  { id: 'salmon', name: 'Grilled Salmon', price: 26, category: 'Mains', base: 20, trendPerWeek: -0.004 },
  { id: 'burger', name: 'Beef Burger', price: 17.5, category: 'Mains', base: 38, trendPerWeek: 0.0 },
  { id: 'caesar', name: 'Caesar Salad', price: 13.5, category: 'Starters', base: 26, trendPerWeek: -0.01 },
  { id: 'soup', name: 'Roast Tomato Soup', price: 9.5, category: 'Starters', base: 18, trendPerWeek: 0.018 },
  { id: 'flatbread', name: 'Margherita Flatbread', price: 15, category: 'Mains', base: 24, trendPerWeek: 0.0 },
  { id: 'tart', name: 'Dark Chocolate Tart', price: 10, category: 'Desserts', base: 15, trendPerWeek: 0.006 },
];

// Share of a typical week's sales falling on each weekday, Sun..Sat (mean ≈ 1).
export const DOW_PATTERN = [1.05, 0.7, 0.75, 0.88, 0.97, 1.3, 1.4];

export const INGREDIENTS = [
  { id: 'chicken_thigh', name: 'Chicken thighs (bone-in)', unit: 'kg', category: 'Meat', shelf_life_days: 4, yield_pct: 0.92, order_cycle_days: 2, min_safety_days: 0.5, max_days_cover: 5 },
  { id: 'salmon_fillet', name: 'Salmon fillet', unit: 'kg', category: 'Seafood', shelf_life_days: 3, yield_pct: 0.9, order_cycle_days: 2, min_safety_days: 0.5, max_days_cover: 4 },
  { id: 'ground_beef', name: 'Ground beef (80/20)', unit: 'kg', category: 'Meat', shelf_life_days: 3, yield_pct: 1, order_cycle_days: 2, min_safety_days: 0.5, max_days_cover: 4 },
  { id: 'mushrooms', name: 'Cremini mushrooms', unit: 'kg', category: 'Produce', shelf_life_days: 5, yield_pct: 0.95, order_cycle_days: 3, min_safety_days: 0.5, max_days_cover: 6 },
  { id: 'romaine', name: 'Romaine lettuce', unit: 'kg', category: 'Produce', shelf_life_days: 6, yield_pct: 0.8, order_cycle_days: 3, min_safety_days: 0.5, max_days_cover: 7 },
  { id: 'burger_buns', name: 'Brioche burger buns', unit: 'each', category: 'Bakery', shelf_life_days: 5, yield_pct: 1, order_cycle_days: 3, min_safety_days: 0.5, max_days_cover: 6 },
  { id: 'cream', name: 'Heavy cream', unit: 'L', category: 'Dairy', shelf_life_days: 10, yield_pct: 1, order_cycle_days: 4, min_safety_days: 1, max_days_cover: 10 },
  { id: 'mozzarella', name: 'Fresh mozzarella', unit: 'kg', category: 'Dairy', shelf_life_days: 14, yield_pct: 1, order_cycle_days: 4, min_safety_days: 1, max_days_cover: 12 },
  { id: 'butter', name: 'Unsalted butter', unit: 'kg', category: 'Dairy', shelf_life_days: 45, yield_pct: 1, order_cycle_days: 7, min_safety_days: 2, max_days_cover: 21 },
  { id: 'parmesan', name: 'Parmesan', unit: 'kg', category: 'Dairy', shelf_life_days: 60, yield_pct: 1, order_cycle_days: 7, min_safety_days: 2, max_days_cover: 28 },
  { id: 'arborio', name: 'Arborio rice', unit: 'kg', category: 'Dry goods', shelf_life_days: 365, yield_pct: 1, order_cycle_days: 7, min_safety_days: 3, max_days_cover: 28 },
  { id: 'flour', name: 'Bread flour', unit: 'kg', category: 'Dry goods', shelf_life_days: 180, yield_pct: 1, order_cycle_days: 7, min_safety_days: 3, max_days_cover: 30 },
  { id: 'canned_tomato', name: 'Canned tomatoes', unit: 'kg', category: 'Dry goods', shelf_life_days: 365, yield_pct: 1, order_cycle_days: 7, min_safety_days: 3, max_days_cover: 30 },
  { id: 'dark_choc', name: 'Dark chocolate 70%', unit: 'kg', category: 'Dry goods', shelf_life_days: 180, yield_pct: 1, order_cycle_days: 7, min_safety_days: 3, max_days_cover: 30 },
  { id: 'olive_oil', name: 'Olive oil', unit: 'L', category: 'Dry goods', shelf_life_days: 365, yield_pct: 1, order_cycle_days: 7, min_safety_days: 3, max_days_cover: 30 },
];

export const RECIPES = [
  { menu_item_id: 'chicken', lines: [['chicken_thigh', 0.32], ['butter', 0.015], ['olive_oil', 0.02], ['mushrooms', 0.04]] },
  { menu_item_id: 'risotto', lines: [['arborio', 0.09], ['mushrooms', 0.15], ['parmesan', 0.025], ['butter', 0.02], ['cream', 0.03]] },
  { menu_item_id: 'salmon', lines: [['salmon_fillet', 0.2], ['olive_oil', 0.015], ['butter', 0.01]] },
  { menu_item_id: 'burger', lines: [['ground_beef', 0.18], ['burger_buns', 1], ['romaine', 0.02]] },
  { menu_item_id: 'caesar', lines: [['romaine', 0.18], ['parmesan', 0.03], ['olive_oil', 0.02]] },
  { menu_item_id: 'soup', lines: [['canned_tomato', 0.3], ['cream', 0.05], ['butter', 0.01], ['olive_oil', 0.01]] },
  { menu_item_id: 'flatbread', lines: [['flour', 0.14], ['canned_tomato', 0.08], ['mozzarella', 0.12], ['olive_oil', 0.01]] },
  { menu_item_id: 'tart', lines: [['dark_choc', 0.07], ['cream', 0.06], ['butter', 0.04], ['flour', 0.05]] },
].map((r) => ({ menu_item_id: r.menu_item_id, lines: r.lines.map(([ingredient_id, qty]) => ({ ingredient_id, qty })) }));

export const SUPPLIERS = [
  { id: 'riverbend', name: 'Riverbend Farm Direct', delivery_fee: 12, free_delivery_over: 120, min_order_value: 40, notes: 'Next-day local delivery, order by 14:00.' },
  { id: 'greenfield', name: 'Greenfield Produce Co.', delivery_fee: 18, free_delivery_over: 250, min_order_value: 60, notes: 'Produce and dairy, daily routes.' },
  { id: 'harbourline', name: 'Harbourline Meat & Seafood', delivery_fee: 25, free_delivery_over: 400, min_order_value: 120, notes: 'Meat and fish, delivery Tue–Sat.' },
  { id: 'metro', name: 'Metro Dry & Dairy Wholesale', delivery_fee: 30, free_delivery_over: 350, min_order_value: 150, notes: 'Broadline dry goods and dairy, 2–3 day lead.' },
];

// [supplier, ingredient, pack_size, pack_price, moq_units, lead_days]
export const OFFERS = [
  ['riverbend', 'chicken_thigh', 8, 52, 8, 1],
  ['harbourline', 'chicken_thigh', 10, 62, 10, 1],
  ['metro', 'chicken_thigh', 10, 58.5, 20, 2],
  ['harbourline', 'salmon_fillet', 4, 88, 4, 1],
  ['harbourline', 'ground_beef', 5, 38, 10, 1],
  ['riverbend', 'ground_beef', 4.5, 36, 9, 1],
  ['greenfield', 'mushrooms', 2.5, 14.5, 2.5, 1],
  ['riverbend', 'mushrooms', 2, 11.8, 2, 1],
  ['metro', 'mushrooms', 2.5, 13.2, 5, 2],
  ['greenfield', 'romaine', 5, 17, 5, 1],
  ['riverbend', 'romaine', 4, 12.8, 4, 1],
  ['metro', 'burger_buns', 48, 19.2, 48, 2],
  ['greenfield', 'burger_buns', 24, 11, 24, 1],
  ['greenfield', 'cream', 4, 13.2, 4, 1],
  ['metro', 'cream', 4, 11.9, 8, 2],
  ['riverbend', 'cream', 2, 7.4, 2, 1],
  ['metro', 'mozzarella', 2.5, 17.5, 5, 2],
  ['greenfield', 'mozzarella', 2, 15.6, 2, 1],
  ['metro', 'butter', 5, 36, 5, 2],
  ['greenfield', 'butter', 2.5, 20.5, 2.5, 1],
  ['metro', 'parmesan', 2, 41, 2, 2],
  ['greenfield', 'parmesan', 1, 22, 1, 1],
  ['metro', 'arborio', 5, 19.5, 5, 2],
  ['metro', 'flour', 25, 21, 25, 2],
  ['metro', 'canned_tomato', 15, 27, 15, 2],
  ['metro', 'dark_choc', 5, 52, 5, 2],
  ['greenfield', 'dark_choc', 2.5, 29, 2.5, 1],
  ['metro', 'olive_oil', 5, 38, 5, 2],
  ['greenfield', 'olive_oil', 3, 25, 3, 1],
].map(([supplier_id, ingredient_id, pack_size, pack_price, moq_units, lead_time_days]) => ({ supplier_id, ingredient_id, pack_size, pack_price, moq_units, lead_time_days }));

// Stock counted the morning of META.asOf. [ingredient, lot, qty, received, expiry (last usable day)]
export const STOCK = [
  ['chicken_thigh', 'CH-1009', 24, '2026-10-07', '2026-10-11'],
  ['salmon_fillet', 'SA-1004', 8, '2026-10-07', '2026-10-10'],
  ['salmon_fillet', 'SA-1005', 12, '2026-10-08', '2026-10-11'],
  ['ground_beef', 'GB-0988', 6, '2026-10-08', '2026-10-11'],
  ['mushrooms', 'MU-2201', 14, '2026-10-07', '2026-10-12'],
  ['romaine', 'RO-3310', 12, '2026-10-06', '2026-10-11'],
  ['romaine', 'RO-3312', 9, '2026-10-08', '2026-10-14'],
  ['burger_buns', 'BB-0711', 120, '2026-10-07', '2026-10-12'],
  ['cream', 'CR-0455', 9, '2026-10-05', '2026-10-15'],
  ['mozzarella', 'MZ-0210', 12, '2026-10-04', '2026-10-18'],
  ['butter', 'BU-0034', 18, '2026-10-01', '2026-11-14'],
  ['parmesan', 'PA-0012', 9, '2026-09-20', '2026-11-19'],
  ['arborio', 'AR-0008', 85, '2026-09-15', '2027-09-15'],
  ['flour', 'FL-0101', 60, '2026-09-26', '2027-03-25'],
  ['canned_tomato', 'CT-0066', 45, '2026-09-26', '2027-09-26'],
  ['dark_choc', 'DC-0020', 9, '2026-09-10', '2027-03-09'],
  ['olive_oil', 'OO-0042', 26, '2026-09-26', '2027-09-26'],
].map(([ingredient_id, lot_id, qty, received_date, expiry_date]) => ({ ingredient_id, lot_id, qty, received_date, expiry_date }));

// Open purchase orders (arrive on arrival_date).
export const INBOUND = [{ ingredient_id: 'cream', qty: 4, arrival_date: '2026-10-10', po_ref: 'PO-2041', shelf_life_days: 10 }];

// Known demand changes. Catering order is a fictional example.
export const EVENTS = [
  { date: '2026-10-11', menu_item_id: 'chicken', extra_units: 60, note: 'Catering: Sunday corporate lunch, 60 guests (confirmed)' },
  { date: '2026-10-11', menu_item_id: 'tart', extra_units: 60, note: 'Catering: Sunday corporate lunch, 60 guests (confirmed)' },
];

// User-entered seasonal assumptions (not learned: only 12 weeks of history exist).
export const SEASONAL = [
  { menu_item_id: 'soup', month: 10, multiplier: 1.1, source: 'Chef assumption: demand rises as weather cools' },
  { menu_item_id: 'caesar', month: 10, multiplier: 0.95, source: 'Chef assumption: lighter dishes soften in autumn' },
];

export const HISTORY_START = '2026-07-17';
export const HISTORY_DAYS = 84;
// A fictional local festival that lifted sales (a one-off the model should not extrapolate).
export const ONE_OFFS = { '2026-09-26': 1.25 };
