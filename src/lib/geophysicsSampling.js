/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Inputs for sampling a geophysics grid at the project's collars and along a
 * profile between two holes, for baselode's `sampleGeophysicsRows` and
 * `sampleGeophysicsProfile`. Pure functions (the coordinate transform is
 * passed in) so they can be tested without baselode.
 */

import { isLocalGridProject } from './projectCoordinates.js';
import { METRES_PER_DEGREE, metresPerGridUnit, niceDistance, rasterCrsUnits } from './geophysicsProcessing.js';

// Geographic collar coordinates are WGS84 lat/long. GDA94 and GDA2020 grids
// differ from WGS84 by under 2 m, well inside a grid cell.
export const COLLAR_GEOGRAPHIC_CRS = 'EPSG:4326';

/**
 * How the project's collars can be placed on a grid.
 *
 * Geographic collars are reprojected to the grid's CRS, which the grid must
 * state. Local-grid collars (easting/northing only) have no CRS, so they are
 * taken to be in the grid's own coordinates.
 *
 * @param {object[]} collars - From ProjectDataContext.
 * @param {object} raster - A baselode geophysics raster.
 * @returns {{rows: Array<{holeId: string, x: number, y: number}>, crs: string|undefined, note: string}
 *   | {rows: null, reason: string}}
 */
export function collarSamplingInput(collars, raster) {
  if (!collars?.length) return { rows: null, reason: 'Load a project with collars to sample this grid at its holes.' };
  if (isLocalGridProject(collars)) {
    return {
      rows: collars.map((collar) => ({ holeId: collar.holeId, x: collar.easting, y: collar.northing })),
      crs: undefined,
      note: 'Collars have local coordinates only, so they are taken to be in the grid\'s coordinates.',
    };
  }
  if (!raster?.crs) {
    return {
      rows: null,
      reason: 'This grid does not state its coordinate system, so the collars\' latitude and longitude cannot be placed on it.',
    };
  }
  return {
    rows: collars.map((collar) => ({ holeId: collar.holeId, x: collar.lng, y: collar.lat })),
    crs: COLLAR_GEOGRAPHIC_CRS,
    note: `Collar latitude and longitude reprojected to ${raster.crs}.`,
  };
}

/**
 * Station spacing for a profile: about one grid cell, as a round distance
 * in metres (or grid units when the grid's units are unknown).
 */
export function defaultProfileSpacing(raster) {
  const [a, b, , d, e] = raster.transform;
  const cell = Math.min(Math.hypot(a, d), Math.hypot(b, e));
  return niceDistance(cell * (metresPerGridUnit(raster) ?? 1));
}

/**
 * Metres per degree along a lat/long line: a degree of longitude shrinks
 * with the cosine of latitude, so the scale depends on the line's bearing.
 * Evaluated at the line's mid-latitude, which is ample over a profile.
 */
function metresPerDegreeAlong([[x0, y0], [x1, y1]]) {
  const cosLat = Math.cos(((y0 + y1) / 2) * (Math.PI / 180));
  const degrees = Math.hypot(x1 - x0, y1 - y0);
  return (METRES_PER_DEGREE * Math.hypot((x1 - x0) * cosLat, y1 - y0)) / degrees;
}

/**
 * The profile line between two collars in the grid's coordinates, and the
 * station spacing in grid units. `metresPerUnit` converts distances along
 * the line back to metres (null when the grid's units are unknown).
 *
 * @param {object} input - From {@link collarSamplingInput}.
 * @param {string} startId - Hole ID.
 * @param {string} endId - Hole ID.
 * @param {number|string} spacing - In metres, or grid units when the grid's units are unknown.
 * @param {object} raster
 * @param {function} transform - `(sourceCrs, targetCrs, points) => points`, e.g. baselode's `transformCrsPoints`.
 * @returns {{vertices: Array<[number, number]>, spacing: number, metresPerUnit: number|null}}
 * @throws {RangeError} For a missing hole, the same hole twice, or a bad spacing.
 */
export function profileBetweenHoles(input, startId, endId, spacing, raster, transform) {
  const byId = new Map(input.rows.map((row) => [row.holeId, row]));
  const start = byId.get(startId);
  const end = byId.get(endId);
  if (!start || !end) throw new RangeError('Choose a start and end hole.');
  if (startId === endId) throw new RangeError('Choose two different holes.');
  const step = spacing === '' || spacing == null ? NaN : Number(spacing);
  if (!(Number.isFinite(step) && step > 0)) throw new RangeError('Spacing must be a positive number.');
  let vertices = [[start.x, start.y], [end.x, end.y]];
  if (input.crs) vertices = transform(input.crs, raster.crs, vertices);
  if (vertices.flat().some((value) => !Number.isFinite(value))) {
    throw new RangeError('These holes could not be placed on the grid.');
  }
  if (vertices[0][0] === vertices[1][0] && vertices[0][1] === vertices[1][1]) {
    throw new RangeError('These holes are at the same position.');
  }
  const metresPerUnit = rasterCrsUnits(raster) === 'degree' ? metresPerDegreeAlong(vertices) : metresPerGridUnit(raster);
  return { vertices, spacing: step / (metresPerUnit ?? 1), metresPerUnit };
}

function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV text for sampled rows.
 *
 * @param {object[]} rows
 * @param {Array<[string, string]>} columns - `[field, header]` pairs.
 * @returns {string}
 */
export function samplesToCsv(rows, columns) {
  const lines = [columns.map(([, header]) => csvField(header)).join(',')];
  for (const row of rows) lines.push(columns.map(([field]) => csvField(row[field])).join(','));
  return `${lines.join('\n')}\n`;
}
