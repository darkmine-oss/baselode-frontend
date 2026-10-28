/* Copyright (C) 2026 Darkmine Pty Ltd; SPDX-License-Identifier: GPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterFormat, rasterSourcesFromFiles } from '../src/lib/geophysicsIo.js';
import { readProjectFromFileList } from '../src/lib/projectIo.js';

function file(path, content = 'x') {
  const name = path.split('/').pop();
  const blob = new File([content], name);
  Object.defineProperty(blob, 'webkitRelativePath', { value: path });
  return blob;
}

test('grid formats are recognised by extension', () => {
  assert.equal(rasterFormat('TMI.ERS'), 'ers');
  assert.equal(rasterFormat('rtp.tif'), 'geotiff');
  assert.equal(rasterFormat('rtp.tiff'), 'geotiff');
  assert.equal(rasterFormat('tmi'), null);
  assert.equal(rasterFormat('collars.csv'), null);
});

test('project grids come from the top level and the geophysics subfolder only', () => {
  const sources = rasterSourcesFromFiles([
    file('p/collars.csv'),
    file('p/tmi.ers'), file('p/tmi', 'TMI'),
    file('p/geophysics/gravity.tif'),
    file('p/archive/old.ers'),
    file('p/geophysics/nested/deep.tif'),
  ], 'project');
  assert.deepEqual(sources.map((source) => [source.label, source.format]), [
    ['geophysics/gravity.tif', 'geotiff'],
    ['tmi.ers', 'ers'],
  ]);
});

test('ERS data files are read from beside their header', async () => {
  const [ers] = rasterSourcesFromFiles([file('p/geophysics/Mag.ers', 'header'), file('p/geophysics/MAG', 'cells'), file('p/mag', 'other')], 'project');
  assert.equal(new TextDecoder().decode(await ers.read()), 'header');
  assert.equal(new TextDecoder().decode(await ers.readSibling('Mag')), 'cells');
  await assert.rejects(ers.readSibling('missing'), /not selected/);
});

test('opened files pair without folder paths', async () => {
  const header = new File(['h'], 'tmi.ers');
  const [ers] = rasterSourcesFromFiles([header, new File(['d'], 'tmi')], 'opened');
  assert.equal(ers.origin, 'opened');
  assert.equal(ers.label, 'tmi.ers');
  assert.equal(new TextDecoder().decode(await ers.readSibling('tmi')), 'd');
});

test('project folders list their grids without reading them', async () => {
  const read = await readProjectFromFileList([
    file('p/collars.csv', 'hole_id,easting,northing\nA,0,10\n'),
    file('p/geophysics/tmi.ers'),
  ]);
  assert.deepEqual(read.rasters.map((source) => source.label), ['geophysics/tmi.ers']);
});
