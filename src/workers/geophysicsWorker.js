/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Runs one geophysics processing request off the UI thread. The page starts
// a worker per request and terminates it when a newer request supersedes it.
import { createGeophysicsRaster, processGeophysicsRaster } from 'baselode/geophysics';

self.onmessage = ({ data: { raster, operation, options } }) => {
  try {
    self.postMessage({ raster: processGeophysicsRaster(createGeophysicsRaster(raster), operation, options) });
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
};
