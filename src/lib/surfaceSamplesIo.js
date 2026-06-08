/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Surface samples parser.  Surface samples (rock chips, stream sediments,
 * soil, outcrop spot samples) live outside the drillhole schema: there's
 * no `hole_id` / `from` / `to` — just a point in space with a sample id,
 * a sample type, and any number of analyte / metadata columns.
 *
 * Expected CSV layout (mirrors `BASELODE_DATA_MODEL_SURFACE_SAMPLE` in
 * baselode.datamodel):
 *
 *   sample_id                     (string, required)
 *   surface_sample_type           (string, required — e.g. "rock_chip",
 *                                   "stream_sediment", "soil", "outcrop")
 *   latitude, longitude           (float, decimal degrees WGS84)
 *   OR easting, northing, crs     (float, projected coords + EPSG / proj string)
 *   elevation                     (float, metres, optional)
 *   datasource_surface_sample_id  (string, optional — upstream ID)
 *   report_number                 (string, optional)
 *   project_id                    (string, optional)
 *   ... any number of analyte / metadata columns ...
 *
 * Any column whose name matches the canonical map is renamed via
 * baselode's `standardizeColumns`; other columns pass through untouched
 * so analyte names (Au_PPM, Cu_PCT, etc.) survive for plot dropdowns.
 */

import Papa from 'papaparse';
import { standardizeColumns } from 'baselode';

const NUMERIC_HINTS = new Set([
  'latitude', 'longitude', 'elevation', 'easting', 'northing',
]);

/**
 * Parse the surface samples CSV text into an array of row objects.
 *
 * Required per the project format docs: `sample_id`,
 * `surface_sample_type`, and either (`latitude`, `longitude`) or
 * (`easting`, `northing`).  Rows missing any of those are dropped
 * (the dropped count is reported via the returned `dropped` field so
 * callers can surface it instead of silently losing data).  Numeric
 * coordinate columns are coerced via Number; analyte columns are
 * left as-is (the Analytics page does its own per-cell numeric
 * coercion).
 *
 * @param {string} csvText
 * @returns {{ rows: Array<Object>, errors: Array<Object>, dropped: number }}
 */
export function parseSurfaceSamples(csvText) {
  if (!csvText) return { rows: [], errors: [], dropped: 0 };
  const { data, errors } = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  const rows = [];
  let dropped = 0;
  for (const raw of data || []) {
    const standardized = standardizeColumns(raw);
    const sampleId = (standardized.sample_id || '').toString().trim();
    const sampleType = (standardized.surface_sample_type || '').toString().trim();
    const out = { ...standardized };
    for (const key of NUMERIC_HINTS) {
      if (out[key] != null && out[key] !== '') {
        const numeric = Number(out[key]);
        out[key] = Number.isFinite(numeric) ? numeric : null;
      }
    }
    const hasLatLng = Number.isFinite(out.latitude) && Number.isFinite(out.longitude);
    const hasEastingNorthing = Number.isFinite(out.easting) && Number.isFinite(out.northing);
    if (!sampleId || !sampleType || !(hasLatLng || hasEastingNorthing)) {
      dropped += 1;
      continue;
    }
    rows.push(out);
  }
  return { rows, errors: errors || [], dropped };
}

/**
 * Convenience predicate for the loaded project state — returns true when
 * the surface_samples table carried at least one usable row.
 */
export function hasSurfaceSamples(state) {
  return Boolean(state?.surfaceSamples?.length);
}
