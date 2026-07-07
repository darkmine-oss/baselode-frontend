/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
// Read the *installed* baselode version so the UI reflects what's actually
// bundled, not just the semver range in package.json.
const baselodePkg = JSON.parse(
  readFileSync(path.resolve(__dirname, 'node_modules/baselode/package.json'), 'utf-8')
);

// Tauri uses 1420 by convention. The dev server must be bound to a fixed port
// so the Rust side can attach to it.
const TAURI_DEV_PORT = 1420;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BASELODE_VERSION__: JSON.stringify(baselodePkg.version),
  },
  plugins: [react()],
  resolve: {
    // When baselode is npm-linked from the workspace (pre-release testing),
    // the symlinked package resolves peers from its own node_modules —
    // loading a second React copy and blank-screening the app at mount.
    // Force the app's single copies (mirrors demo-viewer-react's config).
    dedupe: ['react', 'react-dom', 'three', 'three-viewport-gizmo', 'papaparse', 'plotly.js-dist-min'],
  },
  // Prevent Vite from obscuring Rust build errors in `tauri dev`.
  clearScreen: false,
  server: {
    port: TAURI_DEV_PORT,
    strictPort: true,
    host: '127.0.0.1',
    watch: {
      // Don't watch the Rust side from the JS side.
      ignored: ['**/src-tauri/**'],
    },
  },
  // Tauri serves the built assets from a relative base.
  base: './',
  build: {
    target: 'es2021',
    sourcemap: true,
    // Tauri reads from dist/ by default; keep the default outDir.
  },
});
