/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GeophysicsRasterViewer } from 'baselode';
import './Geophysics.css';
import { useGeophysics } from '../context/GeophysicsContext.jsx';
import { useProjectData } from '../context/ProjectDataContext.jsx';
import { isTauri } from '../lib/projectIo.js';
import { RASTER_SUBFOLDER, pickRasterFiles, rasterSourcesFromFiles } from '../lib/geophysicsIo.js';

function formatNumber(value) {
  if (!Number.isFinite(value)) return '–';
  return Number(value.toPrecision(4)).toLocaleString();
}

function rasterDetails(raster) {
  const [a, b, , d, e] = raster.transform;
  const cellX = Math.hypot(a, d);
  const cellY = Math.hypot(b, e);
  const details = [`${raster.width.toLocaleString()} × ${raster.height.toLocaleString()} cells`];
  details.push(`cell ${formatNumber(cellX)}${cellX === cellY ? '' : ` × ${formatNumber(cellY)}`}`);
  if (raster.crs) details.push(raster.crs);
  else if (raster.metadata?.projection) details.push(`${raster.metadata.datum ?? ''} ${raster.metadata.projection}`.trim());
  const decimation = (raster.metadata?.processing ?? []).find((step) => step.operation === 'decimate');
  if (decimation) details.push(`averaged ${decimation.factor}× for display`);
  return details;
}

function Geophysics() {
  const project = useProjectData();
  const { sources, selected, select, addOpened, removeOpened, loaded, band, setBand, view, setView, setActive } = useGeophysics();
  const fileInputRef = useRef(null);
  // The sidebar slot may not exist yet on the first render (direct
  // navigation to this page), so look it up once mounted.
  const [controlsTarget, setControlsTarget] = useState(null);
  useEffect(() => setControlsTarget(document.getElementById('geophysics-controls-slot')), []);
  useEffect(() => {
    setActive(true);
    return () => setActive(false);
  }, [setActive]);

  const onOpenClick = async () => {
    if (!isTauri()) {
      fileInputRef.current?.click();
      return;
    }
    try {
      addOpened(await pickRasterFiles());
    } catch (e) {
      console.error('pickRasterFiles failed', e);
    }
  };

  const onFileInputChange = (event) => {
    addOpened(rasterSourcesFromFiles(event.target.files || [], 'opened'));
    event.target.value = '';
  };

  const raster = loaded.raster;
  const bandIndex = raster ? Math.min(band, raster.bandCount) : 1;
  const units = raster?.metadata?.units?.[bandIndex - 1] ?? undefined;
  const groups = [
    ['Project', sources.filter((source) => source.origin === 'project')],
    ['Opened', sources.filter((source) => source.origin === 'opened')],
  ].filter(([, items]) => items.length);

  const sidebarControls = (
    <div className="geophysics-controls">
      <div className="label-caps">Geophysics grids</div>
      {groups.map(([title, items]) => (
        <div key={title} className="geophysics-source-group">
          <div className="geophysics-source-group-title">{title}</div>
          <ul className="geophysics-source-list">
            {items.map((source) => (
              <li key={source.id} className={source.id === selected?.id ? 'active' : ''}>
                <button type="button" className="geophysics-source" onClick={() => select(source.id)} title={source.label}>
                  {source.label}
                </button>
                {source.origin === 'opened' && (
                  <button
                    type="button"
                    className="geophysics-source-remove"
                    onClick={() => removeOpened(source.id)}
                    aria-label={`Remove ${source.label}`}
                    title="Remove from list"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <button type="button" className="ghost-button small" onClick={onOpenClick}>Open grid files…</button>
    </div>
  );

  let body;
  if (!selected) {
    body = (
      <div className="page-empty-state">
        <h2>No geophysics grids</h2>
        <p>
          Open ER Mapper (<code>.ers</code>) or GeoTIFF grids, or place them in the project folder or
          its <code>{RASTER_SUBFOLDER}/</code> subfolder.
          {project.status === 'ready' && ' The current project has none.'}
        </p>
        <button type="button" className="primary-button" onClick={onOpenClick}>Open grid files…</button>
      </div>
    );
  } else if (loaded.status === 'error') {
    body = (
      <div className="page-empty-state">
        <h2>Could not open {selected.label}</h2>
        <p className="error-text" role="alert">{loaded.error}</p>
      </div>
    );
  } else if (!raster) {
    body = (
      <div className="page-empty-state">
        <p>Reading {selected.label}…</p>
      </div>
    );
  } else {
    body = (
      <>
        <header className="geophysics-header">
          <div>
            <h1>{selected.label}</h1>
            <p className="geophysics-details">{rasterDetails(raster).join(' · ')}</p>
          </div>
          {raster.bandCount > 1 && (
            <label className="geophysics-band">
              <span>Band</span>
              <select value={bandIndex} onChange={(event) => setBand(Number(event.target.value))}>
                {raster.bandNames.map((name, index) => (
                  <option key={name + index} value={index + 1}>
                    {name}{raster.metadata?.units?.[index] ? ` (${raster.metadata.units[index]})` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>
        <GeophysicsRasterViewer
          className="geophysics-viewer"
          raster={raster}
          band={bandIndex}
          units={units}
          value={view}
          onViewChange={setView}
          height="auto"
        />
      </>
    );
  }

  return (
    <div className="geophysics-container">
      {body}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        // ERS grids need the header and its extensionless data file, so the
        // browser picker can't filter by extension.
        onChange={onFileInputChange}
      />
      {controlsTarget && createPortal(sidebarControls, controlsTarget)}
    </div>
  );
}

export default Geophysics;
