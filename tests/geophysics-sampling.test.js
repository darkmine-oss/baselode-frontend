/* Copyright (C) 2026 Darkmine Pty Ltd; SPDX-License-Identifier: GPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLLAR_GEOGRAPHIC_CRS,
  collarSamplingInput,
  defaultProfileSpacing,
  profileBetweenHoles,
  samplesToCsv,
} from '../src/lib/geophysicsSampling.js';
import { METRES_PER_DEGREE } from '../src/lib/geophysicsProcessing.js';

const projected = { crs: 'EPSG:28350', transform: [50, 0, 400000, 0, -50, 7000000], width: 400, height: 200, metadata: { crs_units: 'metre' } };
const geographic = { crs: 'EPSG:4283', transform: [0.00225, 0, 118.4, 0, -0.00225, -23.4], width: 470, height: 579, metadata: { crs_units: 'degree' } };
const unreferenced = { crs: null, transform: [2, 0, 0, 0, -2, 100], width: 50, height: 50, metadata: {} };

const geographicCollars = [
  { holeId: 'A', lat: -27, lng: 117, easting: NaN, northing: NaN },
  { holeId: 'B', lat: -27.01, lng: 117.02, easting: NaN, northing: NaN },
];
const localCollars = [
  { holeId: 'L1', lat: NaN, lng: NaN, easting: 10, northing: 20 },
  { holeId: 'L2', lat: NaN, lng: NaN, easting: 40, northing: 60 },
];

// Stand-in for baselode's transformCrsPoints: records the call and shifts.
function fakeTransform(calls) {
  return (source, target, points) => {
    calls.push([source, target]);
    return points.map(([x, y]) => [x * 1000, y * 1000]);
  };
}

test('geographic collars are reprojected from lat/long to a referenced grid', () => {
  const input = collarSamplingInput(geographicCollars, projected);
  assert.equal(input.crs, COLLAR_GEOGRAPHIC_CRS);
  assert.deepEqual(input.rows, [{ holeId: 'A', x: 117, y: -27 }, { holeId: 'B', x: 117.02, y: -27.01 }]);
  assert.match(input.note, /EPSG:28350/);
});

test('geographic collars cannot be placed on a grid without a CRS', () => {
  const input = collarSamplingInput(geographicCollars, unreferenced);
  assert.equal(input.rows, null);
  assert.match(input.reason, /coordinate system/);
});

test('local-grid collars are used in the grid coordinates without a CRS', () => {
  for (const raster of [unreferenced, projected]) {
    const input = collarSamplingInput(localCollars, raster);
    assert.equal(input.crs, undefined);
    assert.deepEqual(input.rows.map(({ x, y }) => [x, y]), [[10, 20], [40, 60]]);
  }
});

test('no collars gives a reason instead of rows', () => {
  assert.equal(collarSamplingInput([], projected).rows, null);
  assert.equal(collarSamplingInput(undefined, projected).rows, null);
});

test('default spacing is about one cell, in metres', () => {
  assert.equal(defaultProfileSpacing(projected), 50);
  assert.equal(defaultProfileSpacing(geographic), 200); // 0.00225° ≈ 250 m
  assert.equal(defaultProfileSpacing(unreferenced), 2);
});

test('a profile between holes is laid out in the grid CRS with spacing in grid units', () => {
  const calls = [];
  const input = collarSamplingInput(geographicCollars, projected);
  const line = profileBetweenHoles(input, 'A', 'B', '100', projected, fakeTransform(calls));
  assert.deepEqual(calls, [[COLLAR_GEOGRAPHIC_CRS, 'EPSG:28350']]);
  assert.deepEqual(line.vertices, [[117000, -27000], [117020, -27010]]);
  assert.equal(line.spacing, 100);
  assert.equal(line.metresPerUnit, 1);
});

test('lat/long profiles scale degrees by the line bearing', () => {
  const input = collarSamplingInput(geographicCollars, geographic);
  const identity = (source, target, points) => points;
  // East-west at 60°S: a degree of longitude is half a degree of latitude.
  const east = profileBetweenHoles(
    { rows: [{ holeId: 'W', x: 117, y: -60 }, { holeId: 'E', x: 118, y: -60 }], crs: 'EPSG:4326' },
    'W', 'E', 1000, geographic, identity,
  );
  assert.ok(Math.abs(east.metresPerUnit - METRES_PER_DEGREE / 2) < 1);
  assert.ok(Math.abs(east.spacing - 1000 / (METRES_PER_DEGREE / 2)) < 1e-9);
  const north = profileBetweenHoles(
    { rows: [{ holeId: 'S', x: 117, y: -27 }, { holeId: 'N', x: 117, y: -26 }], crs: 'EPSG:4326' },
    'S', 'N', 1000, geographic, identity,
  );
  assert.ok(Math.abs(north.metresPerUnit - METRES_PER_DEGREE) < 1e-6);
  assert.ok(profileBetweenHoles(input, 'A', 'B', 100, geographic, identity).metresPerUnit < METRES_PER_DEGREE);
});

test('local-grid profiles need no transform and keep grid units when unknown', () => {
  const input = collarSamplingInput(localCollars, unreferenced);
  const line = profileBetweenHoles(input, 'L1', 'L2', 5, unreferenced, () => assert.fail('no transform expected'));
  assert.deepEqual(line.vertices, [[10, 20], [40, 60]]);
  assert.equal(line.spacing, 5);
  assert.equal(line.metresPerUnit, null);
});

test('bad profile choices are rejected with a message', () => {
  const input = collarSamplingInput(localCollars, unreferenced);
  const identity = (source, target, points) => points;
  assert.throws(() => profileBetweenHoles(input, 'L1', 'L1', 5, unreferenced, identity), /two different/);
  assert.throws(() => profileBetweenHoles(input, 'L1', 'missing', 5, unreferenced, identity), /start and end/);
  for (const spacing of ['', 0, -1, 'abc']) {
    assert.throws(() => profileBetweenHoles(input, 'L1', 'L2', spacing, unreferenced, identity), /Spacing/);
  }
  const same = { rows: [{ holeId: 'P', x: 1, y: 1 }, { holeId: 'Q', x: 1, y: 1 }] };
  assert.throws(() => profileBetweenHoles(same, 'P', 'Q', 5, unreferenced, identity), /same position/);
  const lost = (source, target, points) => points.map(() => [NaN, NaN]);
  const geo = collarSamplingInput(geographicCollars, projected);
  assert.throws(() => profileBetweenHoles(geo, 'A', 'B', 5, projected, lost), /could not be placed/);
});

test('CSV quotes fields that need it and leaves missing values blank', () => {
  const csv = samplesToCsv(
    [{ holeId: 'A', value: 1.5 }, { holeId: 'B,"2"', value: null }],
    [['holeId', 'hole_id'], ['value', 'Bouguer, mGal']],
  );
  assert.equal(csv, 'hole_id,"Bouguer, mGal"\nA,1.5\n"B,""2""",\n');
});
