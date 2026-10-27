/* Copyright (C) 2026 Darkmine Pty Ltd; SPDX-License-Identifier: GPL-3.0-or-later */
// Input columns have already been standardized by Baselode.
export function collarsFromStandardRows(rows) {
  const number = (v) => v == null || String(v).trim() === '' ? NaN : Number(v);
  if (!rows.length) throw new Error('The collar file contains no data rows.');
  const seen = new Set();
  const collars = rows.map((s, index) => {
    const holeId = String(s.hole_id ?? '').trim();
    const lat = number(s.latitude), lng = number(s.longitude);
    const easting = number(s.easting), northing = number(s.northing);
    const geographic = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    const grid = Number.isFinite(easting) && Number.isFinite(northing);
    if (!holeId || (!geographic && !grid)) throw new Error(`Collar row ${index + 1}: hole ID and complete horizontal coordinates required.`);
    if (seen.has(holeId)) throw new Error(`Duplicate collar hole ID: ${holeId}`);
    seen.add(holeId);
    return { holeId, lat: geographic ? lat : NaN, lng: geographic ? lng : NaN,
      easting, northing, elevation: number(s.elevation), project: String(s.project_id ?? s.dataset ?? '').trim() };
  });
  const hasGeographic = collars.some(c => Number.isFinite(c.lat) && Number.isFinite(c.lng));
  if (hasGeographic && collars.some(c => !Number.isFinite(c.lat) || !Number.isFinite(c.lng))) {
    throw new Error('Collars mix geographic and local-only coordinates. Supply one consistent coordinate system.');
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
