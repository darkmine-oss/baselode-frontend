/* Copyright (C) 2026 Darkmine Pty Ltd; SPDX-License-Identifier: GPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METRES_PER_DEGREE,
  PROCESSING_OPERATIONS,
  defaultProcessingParams,
  isGeographicRaster,
  niceDistance,
  processedUnits,
  processingRequest,
} from '../src/lib/geophysicsProcessing.js';

const projected = { crs: 'EPSG:28350', transform: [50, 0, 400000, 0, -50, 7000000], width: 400, height: 200, metadata: {} };
const geographic = { crs: 'EPSG:4283', transform: [0.00225, 0, 118.4, 0, -0.00225, -23.4], width: 470, height: 579, metadata: {} };

test('geographic grids are recognised by CRS or ERS projection', () => {
  assert.equal(isGeographicRaster(projected), false);
  assert.equal(isGeographicRaster(geographic), true);
  assert.equal(isGeographicRaster({ crs: null, metadata: { projection: 'GEODETIC' } }), true);
  assert.equal(isGeographicRaster({ crs: null, metadata: { projection: 'MGA50' } }), false);
});

test('defaults scale with the grid and are round numbers', () => {
  assert.deepEqual(defaultProcessingParams(projected), {
    inclination: -55, declination: 1, height: 200, wavelength: 1000, longWavelength: 2000, shortWavelength: 200,
  });
  // 470 x 0.00225 degrees is about 118 km east-west (the shorter side).
  assert.equal(defaultProcessingParams(geographic).wavelength, 10000);
  assert.deepEqual([0.7, 1.4, 1.6, 3.4, 3.6, 7.4, 7.6, 1234].map(niceDistance), [0.5, 1, 2, 2, 5, 5, 10, 1000]);
});

test('requests convert metres to degrees for geographic grids', () => {
  assert.equal(processingRequest('none', {}, projected), null);
  assert.deepEqual(processingRequest('upward_continuation', { height: '250' }, projected), {
    operation: 'upward_continuation', options: { height: 250 },
  });
  const request = processingRequest('band_pass', { longWavelength: 2000, shortWavelength: 500 }, geographic);
  assert.equal(request.operation, 'band_pass');
  assert.ok(Math.abs(request.options.longWavelength - 2000 / METRES_PER_DEGREE) < 1e-15);
  assert.deepEqual(processingRequest('second_vertical_derivative', {}, projected), {
    operation: 'vertical_derivative', options: { order: 2 },
  });
  assert.deepEqual(processingRequest('reduce_to_pole', { inclination: -55, declination: '1.5' }, geographic), {
    operation: 'reduce_to_pole', options: { inclination: -55, declination: 1.5 },
  });
  assert.throws(() => processingRequest('low_pass', { wavelength: '' }, projected), /must be a number/);
});

test('units follow the operation', () => {
  assert.equal(processedUnits('tilt_derivative', 'nT', projected), '°');
  assert.equal(processedUnits('reduce_to_pole', 'nT', projected), 'nT');
  assert.equal(processedUnits('vertical_derivative', 'nT', projected), 'nT/m');
  assert.equal(processedUnits('second_vertical_derivative', 'mGal', geographic), 'mGal/°²');
  assert.equal(processedUnits('analytic_signal', undefined, projected), undefined);
});

test('every operation maps to a baselode operation', async () => {
  const { GEOPHYSICS_OPERATIONS } = await import('baselode').catch(() => ({}));
  if (!GEOPHYSICS_OPERATIONS) return; // baselode needs a browser-like environment
  for (const item of PROCESSING_OPERATIONS.filter((entry) => entry.id !== 'none')) {
    assert.ok(GEOPHYSICS_OPERATIONS.includes(item.operation ?? item.id), item.id);
  }
});
