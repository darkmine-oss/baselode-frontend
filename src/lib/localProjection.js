/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Cheap local tangent-plane projection: meters east/north from a reference
 * lat/lng. Accurate enough for the spatial extent of a typical drilling
 * project (tens of km), which is what we need to visualise traces in a
 * local 3D frame.
 */

const M_PER_DEG_LAT = 111_319.5;

export function makeLocalProjector(refLat, refLng) {
  const cosLat = Math.cos((refLat * Math.PI) / 180);
  return (lat, lng) => ({
    x: (lng - refLng) * M_PER_DEG_LAT * cosLat,
    y: (lat - refLat) * M_PER_DEG_LAT,
  });
}
