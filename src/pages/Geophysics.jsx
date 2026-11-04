/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Component, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GeophysicsRasterViewer, encodeErs, encodeGeoTiff } from 'baselode';
import './Geophysics.css';
import GeophysicsSamplingPanel from './GeophysicsSamplingPanel.jsx';
import { useGeophysics } from '../context/GeophysicsContext.jsx';
import { useProjectData } from '../context/ProjectDataContext.jsx';
import { isTauri } from '../lib/projectIo.js';
import { RASTER_SUBFOLDER, pickRasterFiles, rasterSourcesFromFiles } from '../lib/geophysicsIo.js';
import { SAVE_FORMATS, rasterFiles, saveFileName, singleBand } from '../lib/geophysicsEditing.js';
import { saveRasterFiles } from '../lib/geophysicsSave.js';
import {
  METRES_PER_DEGREE,
  PROCESSING_OPERATIONS,
  distanceUnitLabel,
  processedUnits,
  processingOperation,
  rasterCrsUnits,
} from '../lib/geophysicsProcessing.js';

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

/**
 * Keeps a render failure (e.g. a band with no valid cells) on this page
 * instead of blanking the app. Re-keyed per grid and band so choosing
 * another one retries.
 */
class ViewerErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page-empty-state">
        <h2>Could not display this band</h2>
        <p className="error-text" role="alert">{this.state.error.message || String(this.state.error)}</p>
      </div>
    );
  }
}

function Geophysics() {
  const project = useProjectData();
  const {
    sources, selected, select, addOpened, removeOpened, loaded, raster, band, setBand, view, setView, setActive,
    processingId, processingParams, setProcessingId, setProcessingParam, processed, crop, setCrop, cropError, cropKey,
  } = useGeophysics();
  const [saveFormat, setSaveFormat] = useState('geotiff');
  const [saveState, setSaveState] = useState({ status: 'idle', message: '' });
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

  const bandIndex = raster ? Math.min(band, raster.bandCount) : 1;
  const operation = processingOperation(processingId);
  const processing = operation.id !== 'none';
  // A result for this grid and band; kept on screen while new settings run.
  const result = processing && processed.key === `${selected?.id}:${bandIndex}:${cropKey}` ? processed : null;
  const shownRaster = processing ? result?.raster : raster;
  const shownBand = processing ? 1 : bandIndex;
  const units = raster ? processedUnits(processingId, raster.metadata?.units?.[bandIndex - 1] ?? undefined, raster) : undefined;
  const cropped = crop.enabled && !cropError;
  const decimation = (raster?.metadata?.processing ?? []).find((step) => step.operation === 'decimate');
  // While new settings run, the previous result stays on screen; it must
  // not be saved under the new settings' name.
  const saveable = Boolean(shownRaster) && (!processing || processed.status === 'ready');
  const onSave = async () => {
    if (!saveable) return;
    setSaveState({ status: 'saving', message: '' });
    try {
      const bandName = shownRaster.bandCount > 1 ? shownRaster.bandNames[shownBand - 1] : null;
      const name = saveFileName(selected.label, [bandName, cropped && 'cropped', processing && operation.id], saveFormat);
      const files = rasterFiles(singleBand(shownRaster, shownBand), name, saveFormat, { encodeErs, encodeGeoTiff });
      const path = await saveRasterFiles(files);
      setSaveState(path ? { status: 'saved', message: `Saved ${path}` } : { status: 'idle', message: '' });
    } catch (error) {
      setSaveState({ status: 'error', message: error?.message || String(error) });
    }
  };
  // A message belongs to the grid it was about.
  useEffect(() => setSaveState({ status: 'idle', message: '' }), [shownRaster]);

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

      <div className="label-caps geophysics-processing-title">Processing</div>
      <label className="geophysics-field">
        <span>Operation</span>
        <select value={operation.id} onChange={(event) => setProcessingId(event.target.value)}>
          {PROCESSING_OPERATIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      {operation.params.map((param) => (
        <label key={param.key} className="geophysics-field">
          <span>{param.kind === 'distance' && raster ? `${param.label} (${distanceUnitLabel(raster)})` : param.label}</span>
          <input
            type="number"
            value={processingParams[param.key] ?? ''}
            min={param.min}
            max={param.max}
            step="any"
            onChange={(event) => setProcessingParam(param.key, event.target.value)}
          />
        </label>
      ))}
      {operation.id === 'reduce_to_pole' && (
        <p className="geophysics-hint">
          Use the survey&apos;s geomagnetic field direction from its report or an IGRF calculator.
          Induced magnetisation only.
        </p>
      )}
      {raster && operation.params.some((param) => param.kind === 'distance') && rasterCrsUnits(raster) === 'degree' && (
        <p className="geophysics-hint">
          This grid is in degrees; metres are converted at {(METRES_PER_DEGREE / 1000).toFixed(2)} km per degree.
        </p>
      )}
      {raster && operation.params.some((param) => param.kind === 'distance') && !rasterCrsUnits(raster) && (
        <p className="geophysics-hint">
          This grid does not state its coordinate units, so distances are in its own units.
        </p>
      )}

      <div className="label-caps geophysics-processing-title">Area</div>
      <label className="geophysics-check">
        <input
          type="checkbox"
          checked={crop.enabled}
          onChange={(event) => setCrop({ enabled: event.target.checked })}
        />
        <span>Crop to project collars</span>
      </label>
      {crop.enabled && (
        <label className="geophysics-field">
          <span>Margin ({raster ? distanceUnitLabel(raster) : 'm'})</span>
          <input
            type="number"
            value={crop.margin}
            min="0"
            step="any"
            onChange={(event) => setCrop({ margin: event.target.value })}
          />
        </label>
      )}
      {crop.enabled && cropError && <p className="geophysics-hint" role="alert">{cropError} Showing the whole grid.</p>}

      <div className="label-caps geophysics-processing-title">Save</div>
      <label className="geophysics-field">
        <span>Format</span>
        <select value={saveFormat} onChange={(event) => setSaveFormat(event.target.value)}>
          {SAVE_FORMATS.map((format) => <option key={format.id} value={format.id}>{format.label}</option>)}
        </select>
      </label>
      <button
        type="button"
        className="ghost-button small"
        onClick={onSave}
        disabled={!saveable || saveState.status === 'saving'}
        title="Save the band shown, cropped and processed as shown"
      >
        {saveState.status === 'saving' ? 'Saving…' : 'Save grid…'}
      </button>
      {decimation && (
        <p className="geophysics-hint">
          Saves the grid as displayed, averaged {decimation.factor}× from the file.
        </p>
      )}
      {saveState.message && (
        <p className={saveState.status === 'error' ? 'geophysics-hint error-text' : 'geophysics-hint'} role="status">
          {saveState.message}
        </p>
      )}
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
    let content;
    if (processing && processed.status === 'error' && processed.key === `${selected.id}:${bandIndex}:${cropKey}`) {
      content = (
        <div className="page-empty-state">
          <h2>Could not apply {operation.label.toLowerCase()}</h2>
          <p className="error-text" role="alert">{processed.error}</p>
        </div>
      );
    } else if (!shownRaster) {
      content = (
        <div className="page-empty-state">
          <p>Applying {operation.label.toLowerCase()}…</p>
        </div>
      );
    } else {
      content = (
        <ViewerErrorBoundary key={`${selected.id}:${bandIndex}:${operation.id}`}>
          <GeophysicsRasterViewer
            className="geophysics-viewer"
            raster={shownRaster}
            band={shownBand}
            units={units}
            value={view}
            onViewChange={setView}
            height="auto"
          />
        </ViewerErrorBoundary>
      );
    }
    body = (
      <>
        <header className="geophysics-header">
          <div>
            <h1>{selected.label}</h1>
            <p className="geophysics-details">
              {[
                ...rasterDetails(raster),
                ...(cropped ? ['cropped to collars'] : []),
                ...(processing ? [operation.label + (processed.status === 'processing' ? ' (updating…)' : '')] : []),
              ].join(' · ')}
            </p>
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
        {content}
        <GeophysicsSamplingPanel
          raster={shownRaster ?? null}
          band={shownBand}
          label={processing ? operation.label : raster.bandNames[bandIndex - 1]}
          units={units}
          fileStem={selected.label}
          collars={project.collars}
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
