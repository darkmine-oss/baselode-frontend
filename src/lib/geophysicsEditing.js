/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Cropping a grid to the project's collars, and turning the shown grid into
 * files to save. Pure functions (the coordinate transform and encoders are
 * passed in) so they can be tested without baselode.
 */

import { isLocalGridProject } from './projectCoordinates.js';
import { METRES_PER_DEGREE, metresPerGridUnit, rasterCrsUnits } from './geophysicsProcessing.js';

export const SAVE_FORMATS = Object.freeze([
  { id: 'geotiff', label: 'GeoTIFF (.tif)', extension: 'tif' },
  { id: 'ers', label: 'ER Mapper (.ers)', extension: 'ers' },
]);

/**
 * The box around the project's collars, widened by a margin, in the grid's
 * coordinates.
 *
 * @param {object[]} collars - From ProjectDataContext.
 * @param {object} raster
 * @param {number|string} marginMetres - Metres, or grid units when the grid's units are unknown.
 * @param {function} transform - `(sourceCrs, targetCrs, points) => points`, e.g. baselode's `transformCrsPoints`.
 * @returns {[number, number, number, number]} `[minX, minY, maxX, maxY]`.
 * @throws {RangeError} With a message to show when the box can't be found.
 */
export function collarCropBounds(collars, raster, marginMetres, transform) {
  const margin = marginMetres === '' || marginMetres == null ? NaN : Number(marginMetres);
  if (!(Number.isFinite(margin) && margin >= 0)) throw new RangeError('Margin must be 0 or more.');
  if (!collars?.length) throw new RangeError('Load a project with collars to crop to them.');
  let points;
  if (isLocalGridProject(collars)) {
    points = collars.map((collar) => [collar.easting, collar.northing]);
  } else {
    if (!raster.crs) {
      throw new RangeError('This grid does not state its coordinate system, so the collars cannot be placed on it.');
    }
    points = transform('EPSG:4326', raster.crs, collars.map((collar) => [collar.lng, collar.lat]));
  }
  points = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (!points.length) throw new RangeError('The collars could not be placed on this grid.');
  // Degrees use the north-south scale; the margin is a convenience, not a survey distance.
  const unit = rasterCrsUnits(raster) === 'degree' ? METRES_PER_DEGREE : (metresPerGridUnit(raster) ?? 1);
  const pad = margin / unit;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX - pad, minY - pad, maxX + pad, maxY + pad];
}

/**
 * A file name for a saved grid: the source name without its extension, the
 * processing applied, and the format's extension.
 *
 * @param {string} label - The grid's name, e.g. `tmi.ers`.
 * @param {string[]} steps - Words describing what was done (e.g. `['cropped', 'tilt_derivative']`).
 * @param {string} formatId - A {@link SAVE_FORMATS} id.
 * @returns {string}
 */
export function saveFileName(label, steps, formatId) {
  const format = SAVE_FORMATS.find((item) => item.id === formatId) ?? SAVE_FORMATS[0];
  const stem = String(label || 'grid').replace(/\.(ers|tiff?)$/i, '');
  const name = [stem, ...steps.filter(Boolean)].join('_').replace(/[^\w.-]+/g, '_');
  return `${name}.${format.extension}`;
}

/**
 * The files that make up a saved grid: one GeoTIFF, or an ERS header and
 * its data file (the header name without `.ers`).
 *
 * @param {object} raster
 * @param {string} fileName - Ends in the format's extension.
 * @param {string} formatId
 * @param {{encodeErs: function, encodeGeoTiff: function}} encoders - From baselode.
 * @returns {Array<{name: string, bytes: Uint8Array}>} Primary file first.
 */
export function rasterFiles(raster, fileName, formatId, { encodeErs, encodeGeoTiff }) {
  if (formatId === 'ers') {
    const { header, data } = encodeErs(raster, { name: fileName });
    return [
      // ERS headers are Latin-1 text, as readers decode them.
      { name: fileName, bytes: Uint8Array.from(header, (character) => character.charCodeAt(0) & 0xff) },
      { name: fileName.replace(/\.ers$/i, ''), bytes: new Uint8Array(data) },
    ];
  }
  return [{ name: fileName, bytes: new Uint8Array(encodeGeoTiff(raster)) }];
}

/**
 * One band of a raster as a single-band raster payload, with its name and
 * units, so a saved grid holds what the page shows.
 *
 * @param {object} raster
 * @param {number} band - One-based.
 * @returns {object}
 */
export function singleBand(raster, band) {
  if (raster.bandCount === 1) return raster;
  return {
    data: [raster.data[band - 1]],
    transform: raster.transform,
    crs: raster.crs,
    nodata: raster.nodata,
    bandNames: [raster.bandNames[band - 1]],
    metadata: { ...raster.metadata, units: [raster.metadata?.units?.[band - 1] ?? null] },
  };
}
