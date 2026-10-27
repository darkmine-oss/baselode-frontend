/* Copyright (C) 2026 Darkmine Pty Ltd — SPDX-License-Identifier: GPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import { holeBounds, reconcileSceneBounds } from '../src/lib/sceneBounds.js';

test('extent and fit bounds combine hole coordinates with visible mesh bounds', () => {
  const holes = [{ points: [{ x: 0, y: 1, z: 2 }, { x: 10, y: 5, z: -20 }] }];
  let visible = true, actual;
  const scene = {
    getMeshObjectsBounds: () => visible ? { minX: -50, maxX: 50, minY: -40, maxY: 40, minZ: -10, maxZ: 100 } : null,
    setSceneBounds: value => { actual = value; },
  };
  reconcileSceneBounds(scene, holes);
  assert.deepEqual(actual, { minX: -50, maxX: 50, minY: -40, maxY: 40, minZ: -20, maxZ: 100 });
  visible = false; reconcileSceneBounds(scene, holes);
  assert.deepEqual(actual, { minX: 0, maxX: 10, minY: 1, maxY: 5, minZ: -20, maxZ: 2 });
  reconcileSceneBounds(scene, []); assert.equal(actual, null);
});
test('style edits reuse hole bounds; changed scene membership recalculates them', () => {
  let reads = 0;
  const holes = [{ points: [{ get x() { reads++; return 1; }, y: 2, z: 3 }] }];
  const first = holeBounds(holes); assert.equal(reads, 1);
  assert.equal(holeBounds(holes), first); assert.equal(reads, 1);
  const changed = [...holes, { points: [{ x: 20, y: 30, z: 40 }] }];
  assert.equal(holeBounds(changed).maxX, 20); assert.equal(reads, 2);
});
test('invalid coordinates do not leave stale bounds', () => {
  assert.equal(holeBounds([{ points: [{ x: NaN, y: 1, z: 2 }] }]), null);
});
