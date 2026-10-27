/* Copyright (C) 2026 Darkmine Pty Ltd — SPDX-License-Identifier: GPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendUniqueHoles, collectSceneHoles, loadObjFilesSequentially } from '../src/lib/sceneImports.js';

test('bulk additions preserve all geometry and existing holes without duplicates', () => {
  const points = [{ x: 0, y: 1, z: 2 }, { x: 0, y: 1, z: -20 }];
  const ids = Array.from({ length: 5000 }, (_, index) => `H${index}`);
  const batch = collectSceneHoles([...ids, 'H1'], id => ({ id, points }));
  assert.equal(batch.holes.length, 5000); assert.deepEqual(batch.errors, []);
  const existing = [{ id: 'H1', points: [{ x: 4, y: 5, z: 6 }] }];
  const merged = appendUniqueHoles(existing, batch.holes);
  assert.equal(merged.length, 5000); assert.equal(merged[0], existing[0]);
  assert.equal(merged[1].points, points);
  assert.equal(appendUniqueHoles(merged, batch.holes), merged);
});
test('bulk point additions retain single points and report unavailable geometry', () => {
  const result = collectSceneHoles(['point', 'absent'], id => id === 'point' ? { id, points: [{ x: 0, y: 0, z: 0 }] } : null);
  assert.equal(result.holes.length, 1); assert.equal(result.holes[0].points.length, 1);
  assert.match(result.errors[0], /absent: No 3D geometry/);
});
test('multiple OBJ files load in order and a bad file does not prevent later imports', async () => {
  const called = [], progress = [];
  const result = await loadObjFilesSequentially(['a.obj', 'bad.obj', 'notes.txt', 'b.OBJ'].map(name => ({ name })), {
    load: async file => { called.push(file.name); if (file.name === 'bad.obj') throw Error('Invalid geometry'); return { name: file.name }; },
    onProgress: (i, total) => progress.push([i, total]),
  });
  assert.deepEqual(called, ['a.obj', 'bad.obj', 'b.OBJ']);
  assert.deepEqual(result.entries.map(entry => entry.name), ['a.obj', 'b.OBJ']);
  assert.deepEqual(result.errors, ['bad.obj: Invalid geometry', 'notes.txt: Expected an OBJ file']);
  assert.equal(progress.length, 4); assert.equal(result.cancelled, false);
});
test('a changed project cancels in-flight imports and does not read subsequent files', async () => {
  let current = true; const called = [];
  const result = await loadObjFilesSequentially([{ name: 'a.obj' }, { name: 'b.obj' }], {
    isCurrent: () => current,
    load: async file => { called.push(file.name); current = false; return { name: file.name }; },
  });
  assert.deepEqual(called, ['a.obj']); assert.deepEqual(result.entries, []); assert.equal(result.cancelled, true);
});
