/* Copyright (C) 2026 Darkmine Pty Ltd — SPDX-License-Identifier: GPL-3.0-or-later */
const holeKey = value => `${value ?? ''}`.trim().toLowerCase();

// Continue in a task after the next frame, giving pending React updates a
// paint opportunity before synchronous parsing or a calculation batch.
export function yieldToBrowser() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });
}

/** Prepare scene traces outside rendering, yielding between calculation batches.
 * Parsers and minimum-curvature calculation are supplied by Baselode. The host
 * supplies its coordinate transform and cancels work on project/page changes.
 */
export async function prepareSceneGeometry({ collars, survey, precomputed, projectLatLng }, {
  parseSurvey, parsePrecomputed, desurvey, onProgress = () => {},
  isCurrent = () => true, yieldControl = yieldToBrowser,
}) {
  const cancelled = Symbol('cancelled');
  const check = () => { if (!isCurrent()) throw cancelled; };
  const pause = async message => {
    check(); onProgress(message); await yieldControl(); check();
  };
  const errors = [];
  let surveyRows = [], parsed = null;
  const precomputedByHole = {}, surveyedByHole = new Map();
  try {
    await pause('Preparing 3D data…');
    if (survey?.length) {
      await pause('Reading survey data…');
      try { surveyRows = await parseSurvey(survey) || []; }
      catch (error) { errors.push(`Survey data: ${error.message || error}`); }
      check();
    }
    if (precomputed?.length) {
      await pause('Reading calculated drillhole traces…');
      try { parsed = await parsePrecomputed(precomputed); }
      catch (error) { errors.push(`Calculated drillhole traces: ${error.message || error}`); }
      check();
      let processed = 0;
      for (const hole of parsed?.holes || []) {
        const points = (hole.points || []).map(p => ({
          x: Number(p.x), y: Number(p.y), z: Number(p.z), md: Number(p.md),
        })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
        if (points.length) precomputedByHole[hole.id] = { id: hole.id, project: hole.points?.[0]?.project_id || '', points };
        if (++processed % 500 === 0) await pause(`Preparing drillhole traces: ${processed.toLocaleString()} of ${parsed.holes.length.toLocaleString()}…`);
      }
    }
    if (surveyRows.length && collars.length && projectLatLng) {
      await pause('Preparing survey calculations…');
      const surveyByKey = new Map(), collarByKey = new Map(), canonicalCollars = [];
      for (let i = 0; i < surveyRows.length; i++) {
        const row = surveyRows[i], key = holeKey(row.hole_id);
        if (!surveyByKey.has(key)) surveyByKey.set(key, []);
        surveyByKey.get(key).push(row);
        if ((i + 1) % 5000 === 0) await pause('Preparing survey calculations…');
      }
      for (let i = 0; i < collars.length; i++) {
        const collar = collars[i], key = holeKey(collar?.holeId);
        if (collar?.holeId && !collarByKey.has(key)) {
          const xy = projectLatLng(collar.lat, collar.lng, collar);
          if (Number.isFinite(xy?.x) && Number.isFinite(xy?.y)) {
            collarByKey.set(key, collar);
            const elevation = Number(collar.elevation);
            canonicalCollars.push({ hole_id: collar.holeId, easting: xy.x, northing: xy.y,
              elevation: Number.isFinite(elevation) ? elevation : 0 });
          }
        }
        if ((i + 1) % 1000 === 0) await pause('Preparing survey calculations…');
      }
      // Each hole is independent. Batches preserve all survey stations and
      // call the same Baselode method with the same station-only output.
      for (let start = 0; start < canonicalCollars.length; start += 200) {
        await pause(`Calculating drillhole traces: ${start.toLocaleString()} of ${canonicalCollars.length.toLocaleString()}…`);
        const batch = canonicalCollars.slice(start, start + 200);
        const rows = batch.flatMap(c => surveyByKey.get(holeKey(c.hole_id)) || []);
        if (!rows.length) continue;
        const points = desurvey(batch, rows, { step: null }) || [];
        for (const point of points) {
          const collar = collarByKey.get(holeKey(point?.hole_id));
          if (!collar || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;
          if (!surveyedByHole.has(collar.holeId)) surveyedByHole.set(collar.holeId, {
            id: collar.holeId, project: collar.project || '', points: [],
          });
          surveyedByHole.get(collar.holeId).points.push({ x: point.x, y: point.y, z: point.z, md: point.md });
        }
      }
    }
    await pause('Preparing hole selection…');
    return { surveyedByHole, precomputedByHole, errors, cancelled: false };
  } catch (error) {
    if (error === cancelled) return { cancelled: true };
    errors.push(`3D data preparation failed: ${error.message || error}`);
    surveyedByHole.clear();
    return { surveyedByHole, precomputedByHole, errors, cancelled: false };
  }
}
