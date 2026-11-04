/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Runs one geophysics processing request off the UI thread. The page starts
// a worker per request and terminates it when a newer request supersedes it.
import {
  combineGeophysicsRasters,
  createGeophysicsRaster,
  fillGeophysicsGaps,
  geophysicsUpwardContinuation,
  processGeophysicsRaster,
} from 'baselode/geophysics';

// Operations composed here rather than in baselode (see APP_OPERATIONS).
const APP_OPERATIONS = {
  fill_gaps: (raster, { maxDistance }) => fillGeophysicsGaps(raster, { maxDistance }),
  // The residual is the grid minus its upward-continued (regional) field;
  // record it as one step rather than the subtraction alone.
  residual: (raster, { height }) => {
    const result = combineGeophysicsRasters(raster, geophysicsUpwardContinuation(raster, { height }), 'subtract');
    const processing = [...(raster.metadata.processing ?? []), { operation: 'residual', regional: 'upward_continuation', height }];
    return { ...result, metadata: { ...result.metadata, processing } };
  },
};

function run(raster, operation, options) {
  const app = APP_OPERATIONS[operation];
  return app ? app(raster, options) : processGeophysicsRaster(raster, operation, options);
}

self.onmessage = ({ data: { raster, operation, options } }) => {
  try {
    self.postMessage({ raster: run(createGeophysicsRaster(raster), operation, options) });
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
};
