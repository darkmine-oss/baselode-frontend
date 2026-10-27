/* Copyright (C) 2026 Darkmine Pty Ltd — SPDX-License-Identifier: GPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSceneGeometry, yieldToBrowser } from '../src/lib/scenePreparation.js';

const noYield = async () => {};
function inputs(count = 1) {
  return {
    collars: Array.from({ length: count }, (_, i) => ({ holeId: `H${i}`, elevation: 100 + i, project: 'P', x: i, y: -i })),
    survey: Array.from({ length: count }, (_, i) => ({ hole_id: ` h${i} `, depth: 10, dip: -90, azimuth: 0 })),
    precomputed: null,
    projectLatLng: (_lat, _lng, collar) => ({ x: collar.x, y: collar.y }),
  };
}
const operations = {
  parseSurvey: rows => rows,
  parsePrecomputed: holes => ({ holes }),
  desurvey: collars => collars.map(c => ({ hole_id: c.hole_id, x: c.easting, y: c.northing, z: c.elevation - 10, md: 10 })),
  yieldControl: noYield,
};

test('loading status is published and yielded before parsing or calculating', async () => {
  const events = [];
  const result = await prepareSceneGeometry(inputs(), {
    ...operations,
    onProgress: text => events.push(text),
    yieldControl: async () => { events.push('yield'); },
    parseSurvey: rows => { events.push('parse'); return rows; },
    desurvey: (...args) => { events.push('calculate'); return operations.desurvey(...args); },
  });
  assert.equal(result.cancelled, false);
  for (const name of ['parse', 'calculate']) assert.equal(events[events.indexOf(name) - 1], 'yield');
  assert.equal(events[0], 'Preparing 3D data…');
  assert.match(events.at(-2), /Preparing hole selection/);
});

test('all holes and stations reach Baselode once in batches with original coordinates and station-only output', async () => {
  const input = inputs(405), calls = [];
  input.collars.push({ ...input.collars[0], holeId: 'h0', elevation: 999 });
  input.survey.push({ ...input.survey[0], depth: 20 });
  const before = structuredClone({ collars: input.collars, survey: input.survey });
  const result = await prepareSceneGeometry(input, {
    ...operations,
    desurvey: (collars, rows, options) => {
      calls.push({ collars, rows }); assert.deepEqual(options, { step: null });
      const ids = new Set(collars.map(c => c.hole_id.toLowerCase()));
      assert.ok(rows.every(row => ids.has(row.hole_id.trim().toLowerCase())));
      return operations.desurvey(collars);
    },
  });
  assert.deepEqual(calls.map(call => call.collars.length), [200, 200, 5]);
  assert.equal(calls.reduce((n, call) => n + call.rows.length, 0), 406);
  assert.equal(result.surveyedByHole.size, 405);
  assert.deepEqual(result.surveyedByHole.get('H0'), { id: 'H0', project: 'P', points: [{ x: 0, y: -0, z: 90, md: 10 }] });
  assert.equal(result.surveyedByHole.get('H404').points[0].z, 494);
  assert.deepEqual({ collars: input.collars, survey: input.survey }, before);
});

test('project changes or navigation cancel before work starts or between batches', async () => {
  let calls = 0, current = false;
  const options = { ...operations, isCurrent: () => current,
    desurvey: collars => { calls++; current = false; return operations.desurvey(collars); } };
  assert.deepEqual(await prepareSceneGeometry(inputs(405), options), { cancelled: true });
  assert.equal(calls, 0);
  current = true;
  assert.deepEqual(await prepareSceneGeometry(inputs(405), options), { cancelled: true });
  assert.equal(calls, 1);
});

test('parser and calculation failures finish with visible errors and retain valid precomputed traces', async () => {
  const input = inputs();
  input.precomputed = [{ id: 'H0', points: [{ x: 1, y: 2, z: 3, md: 4, project_id: 'P' }] }];
  const parsed = await prepareSceneGeometry(input, { ...operations, parseSurvey: () => { throw Error('Invalid CSV'); } });
  assert.equal(parsed.precomputedByHole.H0.points.length, 1);
  assert.deepEqual(parsed.errors, ['Survey data: Invalid CSV']); assert.equal(parsed.cancelled, false);
  const calculated = await prepareSceneGeometry(input, { ...operations, desurvey: () => { throw Error('Invalid survey'); } });
  assert.equal(calculated.precomputedByHole.H0.points.length, 1);
  assert.match(calculated.errors[0], /Invalid survey/); assert.equal(calculated.surveyedByHole.size, 0);
});

test('projects without survey or precomputed data complete without invoking parsers', async () => {
  const result = await prepareSceneGeometry({ collars: [], survey: null, precomputed: null }, {
    ...operations, parseSurvey: () => assert.fail('unexpected parser'), parsePrecomputed: () => assert.fail('unexpected parser'),
  });
  assert.deepEqual(result.errors, []); assert.equal(result.surveyedByHole.size, 0); assert.equal(result.cancelled, false);
});

test('browser yield waits for a frame and a subsequent task', async () => {
  const original = globalThis.requestAnimationFrame;
  let frame, finished = false;
  globalThis.requestAnimationFrame = callback => { frame = callback; };
  try {
    const pending = yieldToBrowser().then(() => { finished = true; });
    await Promise.resolve(); assert.equal(finished, false);
    frame(); await Promise.resolve(); assert.equal(finished, false);
    await pending; assert.equal(finished, true);
  } finally {
    if (original) globalThis.requestAnimationFrame = original;
    else delete globalThis.requestAnimationFrame;
  }
});
