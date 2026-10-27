/* Copyright (C) 2026 Darkmine Pty Ltd — SPDX-License-Identifier: GPL-3.0-or-later */
/** Merge once per batch; preserve existing objects and source ordering. */
export function appendUniqueHoles(existing, additions) {
  const seen = new Set(existing.map(hole => hole.id));
  const next = [...existing];
  for (const hole of additions) {
    if (seen.has(hole.id)) continue;
    seen.add(hole.id);
    next.push(hole);
  }
  return next.length === existing.length ? existing : next;
}

export function collectSceneHoles(ids, resolve) {
  const holes = [], errors = [];
  for (const id of new Set(ids)) {
    try {
      const hole = resolve(id);
      if (!hole?.points?.length) throw new Error('No 3D geometry available');
      holes.push(hole);
    } catch (error) { errors.push(`${id}: ${error.message || error}`); }
  }
  return { holes, errors };
}

/** Continue after an invalid file; abandon stale project loads between reads. */
export async function loadObjFilesSequentially(files, { load, isCurrent = () => true, onProgress = () => {} }) {
  const entries = [], errors = [];
  for (let index = 0; index < files.length; index++) {
    if (!isCurrent()) return { entries, errors, cancelled: true };
    const file = files[index];
    onProgress(index + 1, files.length, file.name);
    try {
      if (!/\.obj$/i.test(file.name)) throw new Error('Expected an OBJ file');
      const entry = await load(file);
      if (!isCurrent()) return { entries, errors, cancelled: true };
      if (entry) entries.push(entry);
    } catch (error) { errors.push(`${file.name}: ${error.message || error}`); }
    // Allow the loading state to paint between synchronous OBJ parses.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { entries, errors, cancelled: !isCurrent() };
}
