/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Geophysics grid processing choices for the Geophysics page: the operations
 * offered, their parameters and defaults, and conversion of the distances
 * people enter (metres) into the grid's coordinate units for baselode's
 * `processGeophysicsRaster`.
 */

// Metres per degree used to convert distances for geographic (lat/long)
// grids. One degree of latitude is 110.6–111.7 km, so this is approximate.
export const METRES_PER_DEGREE = 111320;

const METRES_PER_UNIT = {
  metre: 1,
  foot: 0.3048,
  us_survey_foot: 1200 / 3937,
  degree: METRES_PER_DEGREE,
};

const UNIT_SYMBOLS = { metre: 'm', foot: 'ft', us_survey_foot: 'US ft', degree: '°' };

// Fallbacks for grids whose files don't state their units (baselode's
// `metadata.crs_units` is null): common geographic CRSs, and metre-based
// projections used for Australian and global surveys.
const GEOGRAPHIC_EPSG = new Set([4019, 4148, 4167, 4171, 4202, 4203, 4258, 4269, 4283, 4326, 4612, 4617, 7844]);
const METRE_EPSG_RANGES = [
  [28348, 28358], // GDA94 / MGA
  [7846, 7859], // GDA2020 / MGA
  [20248, 20258], // AGD66 / AMG
  [20348, 20358], // AGD84 / AMG
  [32601, 32660], // WGS 84 / UTM north
  [32701, 32760], // WGS 84 / UTM south
  [3577, 3577], // GDA94 / Australian Albers
  [9473, 9473], // GDA2020 / Australian Albers
  [3857, 3857], // Web Mercator
];

const DISTANCE = 'distance';
const ANGLE = 'angle';

/**
 * Operations in menu order. `id` identifies the menu entry; `operation` (if
 * different) is the baselode operation name; `none` shows the grid as
 * loaded. `params` lists the inputs shown for each; distance labels get the
 * unit appended.
 */
export const PROCESSING_OPERATIONS = Object.freeze([
  { id: 'none', label: 'None (original grid)', params: [] },
  { id: 'reduce_to_pole', label: 'Reduce to pole (magnetics)', params: [
    { key: 'inclination', label: 'Inclination (°)', kind: ANGLE, min: -90, max: 90 },
    { key: 'declination', label: 'Declination (°)', kind: ANGLE, min: -180, max: 180 },
  ] },
  { id: 'vertical_derivative', label: 'First vertical derivative (1VD)', params: [], options: { order: 1 } },
  { id: 'second_vertical_derivative', operation: 'vertical_derivative', label: 'Second vertical derivative (2VD)', params: [], options: { order: 2 } },
  { id: 'total_horizontal_derivative', label: 'Total horizontal derivative', params: [] },
  { id: 'derivative_east', operation: 'horizontal_derivative', label: 'Horizontal derivative, east', params: [], options: { direction: 'east' } },
  { id: 'derivative_north', operation: 'horizontal_derivative', label: 'Horizontal derivative, north', params: [], options: { direction: 'north' } },
  { id: 'tilt_derivative', label: 'Tilt derivative', params: [] },
  { id: 'analytic_signal', label: 'Analytic signal', params: [] },
  { id: 'upward_continuation', label: 'Upward continuation', params: [
    { key: 'height', label: 'Height', kind: DISTANCE },
  ] },
  { id: 'low_pass', label: 'Low-pass filter (regional)', params: [
    { key: 'wavelength', label: 'Cut-off wavelength', kind: DISTANCE },
  ] },
  { id: 'high_pass', label: 'High-pass filter (residual)', params: [
    { key: 'wavelength', label: 'Cut-off wavelength', kind: DISTANCE },
  ] },
  { id: 'band_pass', label: 'Band-pass filter', params: [
    { key: 'longWavelength', label: 'Longest wavelength', kind: DISTANCE },
    { key: 'shortWavelength', label: 'Shortest wavelength', kind: DISTANCE },
  ] },
]);

const BY_ID = new Map(PROCESSING_OPERATIONS.map((operation) => [operation.id, operation]));

export function processingOperation(id) {
  return BY_ID.get(id) ?? BY_ID.get('none');
}

function epsgCode(raster) {
  const match = /^EPSG:(\d+)$/i.exec(String(raster?.crs ?? ''));
  return match ? Number(match[1]) : null;
}

/**
 * A raster's coordinate units: `'degree'`, `'metre'`, `'foot'`,
 * `'us_survey_foot'`, or null when they can't be determined. Uses
 * baselode's `metadata.crs_units`, then well-known EPSG codes. Coordinate
 * values alone are not trusted: a fine local grid near the origin looks
 * like degrees.
 */
export function rasterCrsUnits(raster) {
  const recorded = raster?.metadata?.crs_units;
  if (recorded && recorded in METRES_PER_UNIT) return recorded;
  const code = epsgCode(raster);
  if (GEOGRAPHIC_EPSG.has(code)) return 'degree';
  if (METRE_EPSG_RANGES.some(([low, high]) => code >= low && code <= high)) return 'metre';
  return null;
}

/** Label for distance inputs: metres, or the grid's own units when unknown. */
export function distanceUnitLabel(raster) {
  return rasterCrsUnits(raster) ? 'm' : 'grid units';
}

/** Grid extent `[width, height]` in the units distances are entered in. */
function rasterExtent(raster) {
  const [a, b, , d, e] = raster.transform;
  const scale = METRES_PER_UNIT[rasterCrsUnits(raster)] ?? 1;
  return [Math.hypot(a, d) * raster.width * scale, Math.hypot(b, e) * raster.height * scale];
}

/** Round to one significant figure of 1, 2 or 5 (a "nice" distance). */
export function niceDistance(value) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const leading = value / power;
  return (leading < 1.5 ? 1 : leading < 3.5 ? 2 : leading < 7.5 ? 5 : 10) * power;
}

/**
 * Default parameter values for a grid, in the units shown (metres, or grid
 * units when unknown; degrees for angles). Distances scale with the grid:
 * filters cut at a tenth of its shorter side (band-pass between a quarter
 * and a fortieth), upward continuation at a fiftieth. The field direction
 * suits Western Australia; replace it with the survey's values.
 */
export function defaultProcessingParams(raster) {
  const shorter = Math.min(...rasterExtent(raster));
  return {
    inclination: -55,
    declination: 1,
    height: niceDistance(shorter / 50),
    wavelength: niceDistance(shorter / 10),
    longWavelength: niceDistance(shorter / 4),
    shortWavelength: niceDistance(shorter / 40),
  };
}

/**
 * Turn a page selection into a baselode call: `{operation, options}` with
 * distances converted from metres to the grid's units (or passed through
 * when those are unknown), or null for the original grid.
 *
 * @param {string} id - A {@link PROCESSING_OPERATIONS} id.
 * @param {object} params - Values in display units, keyed by param `key`.
 * @param {object} raster
 * @returns {{operation: string, options: object}|null}
 */
export function processingRequest(id, params, raster) {
  const operation = processingOperation(id);
  if (operation.id === 'none') return null;
  const scale = 1 / (METRES_PER_UNIT[rasterCrsUnits(raster)] ?? 1);
  const options = { ...(operation.options ?? {}) };
  for (const param of operation.params) {
    const raw = params[param.key];
    const value = raw === '' || raw == null ? NaN : Number(raw);
    if (!Number.isFinite(value)) throw new RangeError(`${param.label} must be a number.`);
    options[param.key] = param.kind === DISTANCE ? value * scale : value;
  }
  return { operation: operation.operation ?? operation.id, options };
}

/**
 * Units for a processed band, or undefined when they can't be stated.
 * Derivatives are per grid unit, as baselode computes them.
 *
 * @param {string} id - A {@link PROCESSING_OPERATIONS} id.
 * @param {string|undefined} units - The original band's units.
 * @param {object} raster
 * @returns {string|undefined}
 */
export function processedUnits(id, units, raster) {
  if (id === 'tilt_derivative') return '°';
  const operation = processingOperation(id);
  if (['none', 'reduce_to_pole', 'upward_continuation', 'low_pass', 'high_pass', 'band_pass'].includes(operation.id)) {
    return units;
  }
  const distance = UNIT_SYMBOLS[rasterCrsUnits(raster)];
  if (!units || !distance) return undefined;
  return operation.id === 'second_vertical_derivative' ? `${units}/${distance}²` : `${units}/${distance}`;
}
