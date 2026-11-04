/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import {
  BASELODE_DARK_TEMPLATE,
  BASELODE_TEMPLATE,
  sampleGeophysicsProfile,
  sampleGeophysicsRows,
  transformCrsPoints,
} from 'baselode';
import { useTheme } from '../context/ThemeContext.jsx';
import { isTauri } from '../lib/projectIo.js';
import {
  collarSamplingInput,
  defaultProfileSpacing,
  profileBetweenHoles,
  samplesToCsv,
} from '../lib/geophysicsSampling.js';
import { distanceUnitLabel } from '../lib/geophysicsProcessing.js';

const MODES = [
  ['collars', 'Values at collars'],
  ['profile', 'Profile between holes'],
];

function formatValue(value) {
  if (value === null || !Number.isFinite(value)) return '–';
  return Number(value.toPrecision(5)).toLocaleString();
}

function csvFileName(name, suffix) {
  return `${String(name).replace(/[^\w.-]+/g, '_')}_${suffix}.csv`;
}

/** Copy CSV text, plus a download button outside the desktop app. */
function CsvActions({ csv, fileName }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [csv]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(csv);
      setCopied(true);
    } catch (error) {
      console.error('Copy CSV failed', error);
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="geophysics-sampling-actions">
      <button type="button" className="ghost-button small" onClick={copy}>{copied ? 'Copied' : 'Copy CSV'}</button>
      {!isTauri() && <button type="button" className="ghost-button small" onClick={download}>Download CSV</button>}
    </div>
  );
}

function ProfilePlot({ stations, distanceLabel, valueLabel }) {
  const containerRef = useRef(null);
  const { theme } = useTheme();
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    Plotly.react(container, [{
      type: 'scatter',
      mode: 'lines',
      x: stations.map((station) => station.distance),
      y: stations.map((station) => station.value),
      connectgaps: false,
      hovertemplate: '%{x:.4~g}: %{y:.5~g}<extra></extra>',
    }], {
      template: theme === 'dark' ? BASELODE_DARK_TEMPLATE : BASELODE_TEMPLATE,
      autosize: true,
      margin: { l: 64, r: 16, t: 8, b: 44 },
      xaxis: { title: { text: distanceLabel } },
      yaxis: { title: { text: valueLabel } },
    }, { responsive: true, displayModeBar: 'hover' }).catch((error) => console.warn('Profile plot failed', error));
    return () => {
      try { Plotly.purge(container); } catch (_) { /* unmounted */ }
    };
  }, [stations, distanceLabel, valueLabel, theme]);
  return <div ref={containerRef} className="geophysics-profile-plot" />;
}

/**
 * Grid values at the project's collars, or along a profile between two
 * holes, for the grid shown on the Geophysics page.
 *
 * @param {object} props
 * @param {object} props.raster - The shown (possibly processed) raster.
 * @param {number} props.band
 * @param {string} props.label - What the values are, for headers.
 * @param {string} [props.units]
 * @param {string} props.fileStem - Base name for downloaded CSVs.
 * @param {object[]} props.collars
 */
function GeophysicsSamplingPanel({ raster, band, label, units, fileStem, collars }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('collars');
  const [method, setMethod] = useState('bilinear');
  const [startId, setStartId] = useState('');
  const [endId, setEndId] = useState('');
  const [spacing, setSpacing] = useState(() => (raster ? defaultProfileSpacing(raster) : ''));
  // While a processed grid is computed `raster` is null; the panel stays
  // open on the same tab and fills in when the result arrives.
  const input = useMemo(
    () => (raster ? collarSamplingInput(collars, raster) : { rows: null, reason: 'Applying processing…' }),
    [collars, raster],
  );
  const holeIds = useMemo(() => (input.rows ?? []).map((row) => row.holeId).sort(), [input]);
  const valueLabel = units ? `${label} (${units})` : label;
  const distanceUnits = raster ? distanceUnitLabel(raster) : 'm';
  const decimation = (raster?.metadata?.processing ?? []).find((step) => step.operation === 'decimate');

  // A new grid gets a spacing to suit its cells (processing keeps the
  // cells, so it keeps the spacing); the holes stay chosen.
  const transform = raster?.transform?.join(',');
  useEffect(() => {
    if (raster) setSpacing(defaultProfileSpacing(raster));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transform]);
  useEffect(() => {
    if (!holeIds.length) return;
    setStartId((current) => (holeIds.includes(current) ? current : holeIds[0]));
    setEndId((current) => (holeIds.includes(current) ? current : holeIds[holeIds.length - 1]));
  }, [holeIds]);

  const collarResult = useMemo(() => {
    if (!open || mode !== 'collars' || !input.rows) return null;
    try {
      const rows = sampleGeophysicsRows(raster, input.rows, {
        xField: 'x', yField: 'y', field: 'value', band, method, crs: input.crs,
      });
      return { rows, error: '' };
    } catch (error) {
      return { rows: [], error: error.message || String(error) };
    }
  }, [open, mode, input, raster, band, method]);

  const profileResult = useMemo(() => {
    if (!open || mode !== 'profile' || !input.rows) return null;
    try {
      const line = profileBetweenHoles(input, startId, endId, spacing, raster, transformCrsPoints);
      const scale = line.metresPerUnit ?? 1;
      const stations = sampleGeophysicsProfile(raster, line.vertices, { spacing: line.spacing, band, method })
        .map((station) => ({ ...station, distance: station.distance * scale }));
      return { stations, error: '' };
    } catch (error) {
      return { stations: [], error: error.message || String(error) };
    }
  }, [open, mode, input, startId, endId, spacing, raster, band, method]);

  const onGrid = collarResult?.rows.filter((row) => row.value !== null).length ?? 0;
  const distanceLabel = `Distance from ${startId} (${distanceUnits})`;

  return (
    <section className={`geophysics-sampling ${open ? 'open' : ''}`}>
      <header className="geophysics-sampling-header">
        <button
          type="button"
          className="geophysics-sampling-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? '▾' : '▸'} Grid values
        </button>
        {open && (
          <div className="geophysics-sampling-tabs" role="tablist">
            {MODES.map(([id, title]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                className={mode === id ? 'active' : ''}
                onClick={() => setMode(id)}
              >
                {title}
              </button>
            ))}
          </div>
        )}
        {open && input.rows && (
          <label className="geophysics-sampling-option">
            <span>Interpolation</span>
            <select value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="bilinear">Bilinear</option>
              <option value="nearest">Nearest cell</option>
            </select>
          </label>
        )}
      </header>

      {open && !input.rows && <p className="geophysics-hint geophysics-sampling-body">{input.reason}</p>}
      {open && input.rows && decimation && (
        <p className="geophysics-hint geophysics-sampling-note">
          Values come from the grid as displayed, averaged {decimation.factor}× from the file.
        </p>
      )}

      {open && input.rows && mode === 'collars' && collarResult && (
        <div className="geophysics-sampling-body">
          {collarResult.error ? (
            <p className="error-text" role="alert">{collarResult.error}</p>
          ) : (
            <>
              <div className="geophysics-sampling-summary">
                <p className="geophysics-hint">
                  {onGrid.toLocaleString()} of {collarResult.rows.length.toLocaleString()} holes are on the grid. {input.note}
                </p>
                <CsvActions
                  csv={samplesToCsv(collarResult.rows, [['holeId', 'hole_id'], ['value', label]])}
                  fileName={csvFileName(fileStem, 'collars')}
                />
              </div>
              <div className="geophysics-sampling-table-wrap">
                <table className="geophysics-sampling-table">
                  <thead>
                    <tr><th>Hole</th><th>{valueLabel}</th></tr>
                  </thead>
                  <tbody>
                    {collarResult.rows.map((row) => (
                      <tr key={row.holeId} className={row.value === null ? 'missing' : ''}>
                        <td>{row.holeId}</td>
                        <td>{row.value === null ? 'off grid or no data' : formatValue(row.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {open && input.rows && mode === 'profile' && profileResult && (
        <div className="geophysics-sampling-body">
          <div className="geophysics-sampling-profile-controls">
            <label className="geophysics-sampling-option">
              <span>From</span>
              <select value={startId} onChange={(event) => setStartId(event.target.value)}>
                {holeIds.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </label>
            <label className="geophysics-sampling-option">
              <span>To</span>
              <select value={endId} onChange={(event) => setEndId(event.target.value)}>
                {holeIds.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </label>
            <label className="geophysics-sampling-option">
              <span>Spacing ({distanceUnits})</span>
              <input type="number" min="0" step="any" value={spacing} onChange={(event) => setSpacing(event.target.value)} />
            </label>
            {!profileResult.error && (
              <CsvActions
                csv={samplesToCsv(profileResult.stations, [['distance', `distance_${distanceUnits === 'm' ? 'm' : 'grid_units'}`], ['x', 'x'], ['y', 'y'], ['value', label]])}
                fileName={csvFileName(fileStem, `profile_${startId}_${endId}`)}
              />
            )}
          </div>
          {profileResult.error ? (
            <p className="error-text" role="alert">{profileResult.error}</p>
          ) : (
            <ProfilePlot stations={profileResult.stations} distanceLabel={distanceLabel} valueLabel={valueLabel} />
          )}
        </div>
      )}
    </section>
  );
}

export default GeophysicsSamplingPanel;
