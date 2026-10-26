/* Copyright (C) 2026 Darkmine Pty Ltd; SPDX-License-Identifier: GPL-3.0-or-later */
// Import JavaScript codecs directly. The package root eagerly instantiates
// hysnappy WebAssembly, which the desktop script-src policy does not permit.
// SNAPPY uses hyparquet's built-in JavaScript implementation.
import { decompress } from 'fzstd';
import { decompressBrotli } from 'hyparquet-compressors/src/brotli.js';
import { gunzip } from 'hyparquet-compressors/src/gzip.js';
import { decompressLz4, decompressLz4Raw } from 'hyparquet-compressors/src/lz4.js';
export const compressors = {
  ZSTD: input => decompress(input),
  GZIP: (input, length) => gunzip(input, new Uint8Array(length)),
  BROTLI: decompressBrotli,
  LZ4: decompressLz4,
  LZ4_RAW: decompressLz4Raw,
};
