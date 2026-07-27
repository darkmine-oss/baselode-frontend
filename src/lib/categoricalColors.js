import Papa from 'papaparse';

const PALETTE = ['#636EFA', '#EF553B', '#00CC96', '#AB63FA', '#FFA15A', '#19D3F3', '#FF6692', '#B6E880', '#FF97FF', '#FECB52'];
const RESERVED_COLUMNS = new Set(['hole_id', 'from', 'to', 'mid', '_source']);
const key = (value) => String(value ?? '').trim().toLowerCase();
const isCategory = (value) => typeof value === 'string' && value.trim() !== '' && !Number.isFinite(Number(value));

function readColorRules(csvText) {
  const global = new Map();
  const byColumn = new Map();
  if (!csvText) return { global, byColumn };

  for (const row of Papa.parse(csvText, { header: true, skipEmptyLines: true }).data || []) {
    const value = String(row.value || '').trim();
    const color = String(row.color || '').trim();
    const column = String(row.column || '').trim();
    if (!value || !/^#[0-9a-f]{6}$/i.test(color)) {
      console.warn('Ignoring invalid colors.csv row', row);
      continue;
    }
    const target = column
      ? (byColumn.get(column) || (byColumn.set(column, new Map()), byColumn.get(column)))
      : global;
    if (target.has(key(value))) console.warn(`Duplicate colors.csv rule for ${column ? `${column}/` : ''}${value}; using the last row.`);
    target.set(key(value), color);
  }
  return { global, byColumn };
}

/**
 * Produces a stable, project-wide categorical map. Column-specific rows in
 * colors.csv override matching global rows for the selected property.
 */
export function buildCategoricalColorMap(holes, csvText, column = '') {
  const values = new Set();
  for (const hole of holes || []) for (const point of hole?.points || []) {
    for (const [name, value] of Object.entries(point || {})) {
      if (!RESERVED_COLUMNS.has(name) && isCategory(value)) values.add(String(value).trim());
    }
  }

  const { global, byColumn } = readColorRules(csvText);
  const overrides = byColumn.get(column) || new Map();
  const out = {};
  let paletteIndex = 0;
  for (const value of [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))) {
    const configured = overrides.get(key(value)) || global.get(key(value));
    out[value] = configured || PALETTE[paletteIndex++ % PALETTE.length];
  }
  return out;
}

export function colorForCategory(map, value, fallback) {
  if (map?.[value]) return map[value];
  const wanted = key(value);
  const match = Object.entries(map || {}).find(([candidate]) => key(candidate) === wanted);
  return match?.[1] || fallback;
}
