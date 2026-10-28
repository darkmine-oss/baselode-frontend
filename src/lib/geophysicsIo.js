/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Geophysics grid discovery and loading: ER Mapper (.ers header + data file)
 * and GeoTIFF/COG. Grids are found at the top of a project folder or in its
 * `geophysics/` subfolder, or opened directly from the Geophysics page.
 *
 * A raster source is `{ id, name, format, origin, read, readSibling }`:
 * `read()` returns the file's bytes and `readSibling(name)` the bytes of a
 * file beside it (the ERS data file). Nothing is read until a grid is shown.
 */
/** Largest grid kept in memory for display; bigger grids are block-averaged. */
export const RASTER_MAX_CELLS = 1_000_000;

export const RASTER_SUBFOLDER = 'geophysics';

const FORMATS = { ers: 'ers', tif: 'geotiff', tiff: 'geotiff' };

export function rasterFormat(name) {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? null : FORMATS[name.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * Read a grid for display.
 *
 * @param {object} source - A raster source (see module comment).
 * @param {object} [options]
 * @param {number} [options.maxCells=RASTER_MAX_CELLS]
 * @returns {Promise<object>} A baselode geophysics raster.
 */
export async function loadRasterSource(source, { maxCells = RASTER_MAX_CELLS } = {}) {
  // Imported on use so project loading (and its Node tests) needn't load baselode.
  const { loadGeoTiff, parseErsHeader, readErs } = await import('baselode');
  if (source.format === 'geotiff') {
    const bytes = await source.read();
    return loadGeoTiff(toArrayBuffer(bytes), { maxCells });
  }
  const headerText = new TextDecoder('latin1').decode(await source.read());
  // The data file is the header name without `.ers` unless it names one.
  const dataName = parseErsHeader(headerText).DataFile || source.name.replace(/\.ers$/i, '');
  let data;
  try {
    data = await source.readSibling(dataName);
  } catch (error) {
    throw new Error(`${source.name}: cannot read data file "${dataName}" (${error?.message || error})`);
  }
  return readErs(headerText, data, { maxCells, name: source.name });
}

function toArrayBuffer(bytes) {
  if (bytes instanceof ArrayBuffer) return bytes;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function sortSources(sources) {
  return sources.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
}

/**
 * Raster sources from browser `File`s: a `<input webkitdirectory>` project
 * selection (top level and `geophysics/`) or a plain multi-file selection.
 * ERS data files are matched by name among the same selection.
 *
 * @param {Iterable<File>} fileList
 * @param {string} origin - `'project'` or `'opened'`.
 * @returns {object[]}
 */
export function rasterSourcesFromFiles(fileList, origin) {
  const byDirectory = new Map(); // directory -> Map(lowercase name -> File)
  const candidates = [];
  for (const file of fileList) {
    const parts = (file.webkitRelativePath || file.name).split('/');
    if (origin === 'project' && !(parts.length === 2 || (parts.length === 3 && parts[1] === RASTER_SUBFOLDER))) continue;
    const directory = parts.slice(0, -1).join('/');
    if (!byDirectory.has(directory)) byDirectory.set(directory, new Map());
    byDirectory.get(directory).set(file.name.toLowerCase(), file);
    if (rasterFormat(file.name)) candidates.push({ file, directory, parts });
  }
  return sortSources(candidates.map(({ file, directory, parts }) => {
    const siblings = byDirectory.get(directory);
    const relative = origin === 'project' ? parts.slice(1).join('/') : file.name;
    return {
      id: `${origin}:${file.webkitRelativePath || file.name}:${file.size}:${file.lastModified}`,
      name: file.name,
      label: relative,
      format: rasterFormat(file.name),
      origin,
      read: async () => new Uint8Array(await file.arrayBuffer()),
      readSibling: async (name) => {
        const sibling = siblings.get(name.toLowerCase());
        if (!sibling) throw new Error('not selected');
        return new Uint8Array(await sibling.arrayBuffer());
      },
    };
  }));
}

/** Raster source for a file path in the Tauri desktop app. */
export function rasterSourceFromPath(path, origin, label) {
  const name = path.split(/[\\/]/).pop();
  const directory = path.slice(0, path.length - name.length);
  return {
    id: `${origin}:${path}`,
    name,
    label: label ?? name,
    format: rasterFormat(name),
    origin,
    read: () => readPath(path),
    readSibling: (sibling) => readPath(`${directory}${sibling}`),
  };
}

async function readPath(path) {
  const fs = await import('@tauri-apps/plugin-fs');
  return fs.readFile(path);
}

/**
 * List the grids in a project folder (Tauri): the folder itself and its
 * `geophysics/` subfolder. Unreadable folders yield no grids.
 *
 * @param {string} folderPath
 * @returns {Promise<object[]>}
 */
export async function listProjectRasters(folderPath) {
  const fs = await import('@tauri-apps/plugin-fs');
  const sep = folderPath.includes('\\') && !folderPath.includes('/') ? '\\' : '/';
  const root = folderPath.endsWith(sep) ? folderPath : `${folderPath}${sep}`;
  const sources = [];
  for (const [directory, prefix] of [[root, ''], [`${root}${RASTER_SUBFOLDER}${sep}`, `${RASTER_SUBFOLDER}/`]]) {
    let entries = [];
    try {
      entries = await fs.readDir(directory);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile && rasterFormat(entry.name)) {
        sources.push(rasterSourceFromPath(`${directory}${entry.name}`, 'project', `${prefix}${entry.name}`));
      }
    }
  }
  return sortSources(sources);
}

/** Native multi-file picker for grids (Tauri). Returns raster sources. */
export async function pickRasterFiles() {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: true,
    directory: false,
    title: 'Open geophysics grids',
    filters: [{ name: 'Geophysics grids', extensions: ['ers', 'tif', 'tiff'] }],
  });
  const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
  return sortSources(paths.map((path) => rasterSourceFromPath(path, 'opened')));
}
