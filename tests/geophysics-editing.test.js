/* Copyright (C) 2026 Darkmine Pty Ltd; SPDX-License-Identifier: GPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_FORMATS, collarCropBounds, rasterFiles, saveFileName, singleBand } from '../src/lib/geophysicsEditing.js';
import { METRES_PER_DEGREE } from '../src/lib/geophysicsProcessing.js';

const projected = { crs: 'EPSG:28350', transform: [50, 0, 400000, 0, -50, 7000000], metadata: { crs_units: 'metre' } };
const geographic = { crs: 'EPSG:4283', transform: [0.00225, 0, 118.4, 0, -0.00225, -23.4], metadata: { crs_units: 'degree' } };
const unreferenced = { crs: null, transform: [2, 0, 0, 0, -2, 100], metadata: {} };

const geographicCollars = [
  { holeId: 'A', lat: -27, lng: 117, easting: NaN, northing: NaN },
  { holeId: 'B', lat: -27.2, lng: 117.3, easting: NaN, northing: NaN },
];
const localCollars = [
  { holeId: 'L1', lat: NaN, lng: NaN, easting: 10, northing: 20 },
  { holeId: 'L2', lat: NaN, lng: NaN, easting: 40, northing: 60 },
];

test('crop bounds surround the collars in the grid CRS with a margin', () => {
  const calls = [];
  const transform = (source, target, points) => {
    calls.push([source, target]);
    return points.map(([x, y]) => [x * 1000, y * 1000]);
  };
  assert.deepEqual(collarCropBounds(geographicCollars, projected, 500, transform), [
    117000 - 500, -27200 - 500, 117300 + 500, -27000 + 500,
  ]);
  assert.deepEqual(calls, [['EPSG:4326', 'EPSG:28350']]);
  // Degree grids convert the margin at the north-south scale.
  const identity = (source, target, points) => points;
  const [minX] = collarCropBounds(geographicCollars, geographic, METRES_PER_DEGREE, identity);
  assert.ok(Math.abs(minX - 116) < 1e-9);
});

test('local-grid collars crop in grid units without a transform', () => {
  const bounds = collarCropBounds(localCollars, unreferenced, '5', () => assert.fail('no transform expected'));
  assert.deepEqual(bounds, [5, 15, 45, 65]);
});

test('crop bounds explain why they cannot be made', () => {
  const identity = (source, target, points) => points;
  assert.throws(() => collarCropBounds([], projected, 0, identity), /collars/);
  assert.throws(() => collarCropBounds(geographicCollars, unreferenced, 0, identity), /coordinate system/);
  assert.throws(() => collarCropBounds(geographicCollars, projected, -1, identity), /Margin/);
  assert.throws(() => collarCropBounds(geographicCollars, projected, '', identity), /Margin/);
  const lost = (source, target, points) => points.map(() => [NaN, NaN]);
  assert.throws(() => collarCropBounds(geographicCollars, projected, 0, lost), /could not be placed/);
});

test('saved file names describe the grid and what was done to it', () => {
  assert.equal(saveFileName('Peak Hill TMI.ers', ['cropped', 'tilt_derivative'], 'geotiff'), 'Peak_Hill_TMI_cropped_tilt_derivative.tif');
  assert.equal(saveFileName('grid.TIF', [false, null], 'ers'), 'grid.ers');
  assert.equal(saveFileName('', [], 'unknown'), 'grid.tif');
  assert.deepEqual(SAVE_FORMATS.map((format) => format.id), ['geotiff', 'ers']);
});

test('an ERS grid is a Latin-1 header and a data file named without .ers', () => {
  const encoders = {
    encodeErs: (raster, { name }) => ({ header: `Name = "${name}" µ`, data: new Uint8Array([1, 2, 3]).buffer }),
    encodeGeoTiff: () => new Uint8Array([9]).buffer,
  };
  const [header, data] = rasterFiles({}, 'tmi_cropped.ers', 'ers', encoders);
  assert.equal(header.name, 'tmi_cropped.ers');
  assert.equal(new TextDecoder('latin1').decode(header.bytes), 'Name = "tmi_cropped.ers" µ');
  assert.deepEqual({ name: data.name, bytes: [...data.bytes] }, { name: 'tmi_cropped', bytes: [1, 2, 3] });
  assert.deepEqual(rasterFiles({}, 'tmi.tif', 'geotiff', encoders).map(({ name, bytes }) => [name, [...bytes]]), [['tmi.tif', [9]]]);
});

test('a saved band keeps its own name and units', () => {
  const raster = {
    bandCount: 2, data: [[[1]], [[2]]], transform: [1, 0, 0, 0, -1, 1], crs: 'EPSG:28350', nodata: null,
    bandNames: ['tmi', 'rtp'], metadata: { units: ['nT', 'nT RTP'], source: 'x.ers' },
  };
  assert.deepEqual(singleBand(raster, 2), {
    data: [[[2]]], transform: [1, 0, 0, 0, -1, 1], crs: 'EPSG:28350', nodata: null,
    bandNames: ['rtp'], metadata: { units: ['nT RTP'], source: 'x.ers' },
  });
  const one = { ...raster, bandCount: 1 };
  assert.equal(singleBand(one, 1), one);
});
