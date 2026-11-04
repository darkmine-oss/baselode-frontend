/* Copyright (C) 2026 Darkmine Pty Ltd; SPDX-License-Identifier: GPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METRES_PER_DEGREE,
  PROCESSING_OPERATIONS,
  defaultProcessingParams,
  distanceUnitLabel,
  niceDistance,
  processedUnits,
  processingRequest,
  rasterCrsUnits,
} from '../src/lib/geophysicsProcessing.js';

const projected = { crs: 'EPSG:28350', transform: [50, 0, 400000, 0, -50, 7000000], width: 400, height: 200, metadata: { crs_units: 'metre' } };
const geographic = { crs: 'EPSG:4283', transform: [0.00225, 0, 118.4, 0, -0.00225, -23.4], width: 470, height: 579, metadata: { crs_units: 'degree' } };

const bounds = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });

test('coordinate units come from baselode metadata, then EPSG codes, then coordinates', () => {
  // Recorded units win, including projected 4xxx codes and feet.
  assert.equal(rasterCrsUnits({ crs: 'EPSG:4087', metadata: { crs_units: 'metre' } }), 'metre');
  assert.equal(rasterCrsUnits({ crs: 'EPSG:2277', metadata: { crs_units: 'us_survey_foot' } }), 'us_survey_foot');
  assert.equal(rasterCrsUnits(geographic), 'degree');
  assert.equal(rasterCrsUnits({ crs: 'EPSG:4269', metadata: {} }), 'degree');
  assert.equal(rasterCrsUnits({ ...projected, metadata: {} }), 'metre');
  // A projected 4xxx code with no recorded units is not assumed to be degrees.
  const worldGrid = { crs: 'EPSG:4087', metadata: {}, transform: [1000, 0, 0, 0, -1000, 0], bounds: bounds(0, -5e5, 1e6, 0) };
  assert.equal(rasterCrsUnits(worldGrid), null);
  // Small coordinates and cells don't establish degrees (a fine local grid).
  const local = { crs: null, metadata: {}, transform: [0.05, 0, 0, 0, -0.05, 5], bounds: bounds(0, 0, 5, 5) };
  assert.equal(rasterCrsUnits(local), null);
  assert.equal(distanceUnitLabel(worldGrid), 'grid units');
  assert.equal(distanceUnitLabel(projected), 'm');
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
  // Feet grids get feet; grids with unknown units take distances as entered.
  const feet = { ...projected, metadata: { crs_units: 'foot' } };
  assert.ok(Math.abs(processingRequest('upward_continuation', { height: 30.48 }, feet).options.height - 100) < 1e-9);
  const unknown = { crs: null, metadata: {}, transform: [25, 0, 0, 0, -25, 0], width: 100, height: 100, bounds: bounds(0, -2500, 2500, 0) };
  assert.equal(processingRequest('upward_continuation', { height: 40 }, unknown).options.height, 40);
});

test('units follow the operation', () => {
  assert.equal(processedUnits('tilt_derivative', 'nT', projected), '°');
  assert.equal(processedUnits('reduce_to_pole', 'nT', projected), 'nT');
  assert.equal(processedUnits('vertical_derivative', 'nT', projected), 'nT/m');
  assert.equal(processedUnits('second_vertical_derivative', 'mGal', geographic), 'mGal/°²');
  assert.equal(processedUnits('analytic_signal', undefined, projected), undefined);
  assert.equal(processedUnits('vertical_derivative', 'nT', { ...projected, metadata: { crs_units: 'foot' } }), 'nT/ft');
  assert.equal(processedUnits('vertical_derivative', 'nT', { crs: null, metadata: {}, transform: [25, 0, 0, 0, -25, 0], bounds: bounds(0, -2500, 2500, 0) }), undefined);
});

test('every operation maps to a baselode operation', async () => {
  const { GEOPHYSICS_OPERATIONS } = await import('baselode').catch(() => ({}));
  if (!GEOPHYSICS_OPERATIONS) return; // baselode needs a browser-like environment
  for (const item of PROCESSING_OPERATIONS.filter((entry) => entry.id !== 'none')) {
    assert.ok(GEOPHYSICS_OPERATIONS.includes(item.operation ?? item.id), item.id);
  }
});
