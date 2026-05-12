/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Project I/O: open a folder, find the canonical files (in .parquet OR .csv
 * form, parquet preferred), and return their contents as CSV text so the
 * existing baselode parsers keep working.
 *
 * Runs in two environments:
 *   - Tauri desktop  → @tauri-apps/plugin-dialog + @tauri-apps/plugin-fs
 *   - Plain browser  → <input type=file webkitdirectory>  (dev fallback)
 */

import Papa from 'papaparse';

/**
 * Canonical project files. Each is looked up as `<key>.parquet` first, then
 * `<key>.csv`. Adding a new file type is just one line here.
 */
export const PROJECT_FILE_KEYS = Object.freeze([
  'collars',
  'survey',
  'assays',
  'geology',
  'structure',
  'precomputed_desurveyed',
]);

export const REQUIRED_FILES = ['collars'];

const EXTENSIONS_BY_PRIORITY = ['parquet', 'csv'];

export function isTauri() {
  return typeof window !== 'undefined' && (
    '__TAURI_INTERNALS__' in window || '__TAURI__' in window
  );
}

/**
 * Opens a native folder picker.  Returns absolute folder path or null if
 * the user cancelled.
 */
export async function pickProjectFolder() {
  if (!isTauri()) {
    throw new Error('Folder picker is only available inside the Tauri desktop app.');
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({ directory: true, multiple: false, title: 'Open Baselode project folder' });
  return typeof selected === 'string' ? selected : null;
}

/**
 * Read each canonical file from a Tauri-picked folder. Missing files
 * resolve to null. Returns `{ folderPath, files: { collars, ... }, formats }`
 * where each file value is CSV text and each format value is 'parquet'|'csv'|null.
 */
export async function readProjectFolder(folderPath) {
  if (!isTauri()) {
    throw new Error('readProjectFolder requires the Tauri desktop runtime.');
  }
  const fs = await import('@tauri-apps/plugin-fs');

  const out = { folderPath, files: {}, formats: {} };
  let scopeRejected = false;

  for (const key of PROJECT_FILE_KEYS) {
    out.files[key] = null;
    out.formats[key] = null;
    for (const ext of EXTENSIONS_BY_PRIORITY) {
      const fullPath = joinPath(folderPath, `${key}.${ext}`);
      let present = false;
      try {
        present = await fs.exists(fullPath);
      } catch (e) {
        // A "forbidden path" error from the fs plugin is the strongest
        // signal that the picked folder sits outside the configured
        // scope. Note it for a clearer error message below.
        if (isScopeError(e)) scopeRejected = true;
        present = false;
      }
      if (!present) continue;

      try {
        if (ext === 'parquet') {
          const bytes = await fs.readFile(fullPath);
          out.files[key] = await parquetBytesToCsvText(bytes);
        } else {
          out.files[key] = await fs.readTextFile(fullPath);
        }
        out.formats[key] = ext;
        break;
      } catch (e) {
        if (isScopeError(e)) scopeRejected = true;
        console.warn(`Failed to read ${key}.${ext}:`, e);
      }
    }
  }

  for (const required of REQUIRED_FILES) {
    if (out.files[required] == null) {
      if (scopeRejected) {
        throw new Error(
          `That folder is outside the locations this app is allowed to read. ` +
          `Place the project inside your home, Desktop, Documents, or Downloads folder.`
        );
      }
      throw new Error(`Missing required file "${required}.csv" or "${required}.parquet" in folder.`);
    }
  }
  return out;
}

function isScopeError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('forbidden path') || msg.includes('not allowed') || msg.includes('not in scope');
}

/**
 * Browser fallback: reads CSVs/Parquets from a FileList produced by a
 * `<input webkitdirectory>` element. Parquet preferred when both formats
 * are present for the same canonical name.
 */
export async function readProjectFromFileList(fileList) {
  const out = { folderPath: '', files: {}, formats: {} };
  for (const key of PROJECT_FILE_KEYS) {
    out.files[key] = null;
    out.formats[key] = null;
  }

  // Bucket files by canonical key + extension so we can prefer parquet.
  const buckets = new Map(); // key -> { parquet?: File, csv?: File }
  for (const file of fileList) {
    const base = file.name.toLowerCase();
    const dot = base.lastIndexOf('.');
    if (dot < 0) continue;
    const stem = base.slice(0, dot);
    const ext = base.slice(dot + 1);
    if (!PROJECT_FILE_KEYS.includes(stem)) continue;
    if (!EXTENSIONS_BY_PRIORITY.includes(ext)) continue;
    if (!buckets.has(stem)) buckets.set(stem, {});
    buckets.get(stem)[ext] = file;
    if (!out.folderPath && file.webkitRelativePath) {
      out.folderPath = file.webkitRelativePath.split('/')[0];
    }
  }

  for (const [key, byExt] of buckets) {
    for (const ext of EXTENSIONS_BY_PRIORITY) {
      const file = byExt[ext];
      if (!file) continue;
      try {
        if (ext === 'parquet') {
          const ab = await file.arrayBuffer();
          out.files[key] = await parquetBytesToCsvText(new Uint8Array(ab));
        } else {
          out.files[key] = await file.text();
        }
        out.formats[key] = ext;
        break;
      } catch (e) {
        console.warn(`Failed to read ${key}.${ext}:`, e);
      }
    }
  }

  for (const required of REQUIRED_FILES) {
    if (out.files[required] == null) {
      throw new Error(`Missing required file "${required}.csv" or "${required}.parquet".`);
    }
  }
  return out;
}

async function parquetBytesToCsvText(bytes) {
  const { parquetReadObjects } = await import('hyparquet');
  // hyparquet wants an ArrayBuffer-like with byteLength + slice.  A plain
  // ArrayBuffer satisfies that interface.
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const rows = await parquetReadObjects({ file: arrayBuffer });
  if (!rows.length) return '';
  return Papa.unparse(rows.map(coerceRowValues));
}

function coerceRowValues(row) {
  // hyparquet returns numbers/strings/booleans/BigInt/null. CSV can't carry
  // BigInt or typed dates verbatim — turn them into plain values.
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) out[k] = '';
    else if (typeof v === 'bigint') out[k] = v.toString();
    else if (v instanceof Date) out[k] = v.toISOString();
    else out[k] = v;
  }
  return out;
}

function joinPath(folder, name) {
  if (!folder) return name;
  const sep = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  return folder.endsWith(sep) ? `${folder}${name}` : `${folder}${sep}${name}`;
}
