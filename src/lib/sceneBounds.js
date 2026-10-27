/* Copyright (C) 2026 Darkmine Pty Ltd — SPDX-License-Identifier: GPL-3.0-or-later */
// Scene membership uses immutable hole arrays. Retain bounds across style edits
// so dragging opacity does not scan every drillhole vertex on every change.
const holeBoundsCache = new WeakMap();

export function holeBounds(holes) {
  if (holeBoundsCache.has(holes)) return holeBoundsCache.get(holes);
  let bounds = null;
  for (const hole of holes) {
    for (const point of hole.points || []) {
      const x = Number(point?.x), y = Number(point?.y), z = Number(point?.z);
      if (![x, y, z].every(Number.isFinite)) continue;
      if (!bounds) bounds = { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z };
      else {
        bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
        bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
        bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
      }
    }
  }
  holeBoundsCache.set(holes, bounds);
  return bounds;
}

/** Fit controls and extent box use the same visible-content bounds. */
export function reconcileSceneBounds(scene, holes) {
  const drilling = holeBounds(holes || []);
  const meshes = scene.getMeshObjectsBounds();
  let bounds = drilling || meshes;
  if (drilling && meshes) {
    bounds = {};
    for (const axis of ['X', 'Y', 'Z']) {
      bounds[`min${axis}`] = Math.min(drilling[`min${axis}`], meshes[`min${axis}`]);
      bounds[`max${axis}`] = Math.max(drilling[`max${axis}`], meshes[`max${axis}`]);
    }
  }
  scene.setSceneBounds(bounds ? { ...bounds } : null);
}
