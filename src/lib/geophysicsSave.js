/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { isTauri } from './projectIo.js';

/**
 * Save a grid's files (from `rasterFiles`). In the desktop app the person
 * picks where; an ERS data file goes beside its header, named as the header
 * without `.ers`. In a browser the files download.
 *
 * @param {Array<{name: string, bytes: Uint8Array}>} files - Primary file first.
 * @returns {Promise<string|null>} Where the primary file went, or null if cancelled.
 */
export async function saveRasterFiles(files) {
  const [primary, ...siblings] = files;
  const extension = primary.name.slice(primary.name.lastIndexOf('.') + 1);
  if (!isTauri()) {
    for (const file of files) {
      const url = URL.createObjectURL(new Blob([file.bytes], { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(url);
    }
    return primary.name;
  }
  const { save } = await import('@tauri-apps/plugin-dialog');
  let path = await save({
    title: 'Save grid',
    defaultPath: primary.name,
    filters: [{ name: extension === 'ers' ? 'ER Mapper grid' : 'GeoTIFF', extensions: [extension] }],
  });
  if (!path) return null;
  if (!path.toLowerCase().endsWith(`.${extension}`)) path = `${path}.${extension}`;
  const fs = await import('@tauri-apps/plugin-fs');
  // The only sibling is an ERS data file: the header path without `.ers`.
  // The save dialog confirmed replacing the header only, so ask about it.
  const siblingPath = path.replace(/\.ers$/i, '');
  if (siblings.length && await fs.exists(siblingPath)) {
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const name = siblingPath.split(/[\\/]/).pop();
    if (!await confirm(`"${name}" already exists beside the header. Replace it with this grid's data?`, {
      title: 'Replace data file?', kind: 'warning',
    })) return null;
  }
  await fs.writeFile(path, primary.bytes);
  for (const file of siblings) await fs.writeFile(siblingPath, file.bytes);
  return path;
}
