/* Copyright (C) 2026 Darkmine Pty Ltd; SPDX-License-Identifier: GPL-3.0-or-later */
// Input columns have already been standardized by Baselode.
export function collarsFromStandardRows(rows, { onWarning = () => {} } = {}) {
  const number = (v) => v == null || String(v).trim() === '' ? NaN : Number(v);
  if (!rows.length) throw new Error('The collar file contains no data rows.');
  const seen = new Map();
  const duplicates = new Set();
  let skipped = 0;
  const collars = [];
  // Source record IDs and row references can differ for the same collar.
  const provenance = new Set(['_collar_id', 'source_table', 'source_row_index']);
  const numeric = new Set(['latitude', 'longitude', 'easting', 'northing', 'elevation', 'max_depth']);
  const comparable = (key, value) => {
    if (value == null || String(value).trim() === '') return null;
    return numeric.has(key) ? number(value) : String(value).trim();
  };
  rows.forEach((s, index) => {
    const holeId = String(s.hole_id ?? '').trim();
    const lat = number(s.latitude), lng = number(s.longitude);
    const easting = number(s.easting), northing = number(s.northing);
    const geographic = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    const grid = Number.isFinite(easting) && Number.isFinite(northing);
    if (!holeId || (!geographic && !grid)) throw new Error(`Collar row ${index + 1}: hole ID and complete horizontal coordinates required.`);
    if (seen.has(holeId)) {
      const first = seen.get(holeId);
      const fields = new Set([...Object.keys(first), ...Object.keys(s)]);
      const conflicts = [...fields].filter(key => !provenance.has(key)
        && !Object.is(comparable(key, first[key]), comparable(key, s[key])));
      if (conflicts.length) {
        throw new Error(`Duplicate collar hole ID: ${holeId} has conflicting values (${conflicts.join(', ')}).`);
      }
      skipped += 1;
      duplicates.add(holeId);
      return;
    }
    seen.set(holeId, s);
    collars.push({ holeId, lat: geographic ? lat : NaN, lng: geographic ? lng : NaN,
      easting, northing, elevation: number(s.elevation), project: String(s.project_id ?? s.dataset ?? '').trim() });
  });
  const hasGeographic = collars.some(c => Number.isFinite(c.lat) && Number.isFinite(c.lng));
  if (hasGeographic && collars.some(c => !Number.isFinite(c.lat) || !Number.isFinite(c.lng))) {
    throw new Error('Collars mix geographic and local-only coordinates. Supply one consistent coordinate system.');
  }
  if (skipped) {
    onWarning(`Loaded ${collars.length} collars. Skipped ${skipped} duplicate collar record${skipped === 1 ? '' : 's'} with matching values; kept the first record for each hole ID: ${[...duplicates].join(', ')}.`);
  }
  return collars;
}
export function isLocalGridProject(collars) {
  return collars.length > 0 && collars.every(c => !Number.isFinite(c.lat) && !Number.isFinite(c.lng)
    && Number.isFinite(c.easting) && Number.isFinite(c.northing));
}
export function localCollarXY(collar) {
  return { x: collar.easting, y: collar.northing };
}
