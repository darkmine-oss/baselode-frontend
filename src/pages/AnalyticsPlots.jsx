/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Plotly from 'plotly.js-dist-min';
import {
  buildScatterPlotConfig,
  buildHistogramPlotConfig,
  buildBoxPlotConfig,
  buildViolinPlotConfig,
  buildTernaryPlotConfig,
  BASELODE_TEMPLATE,
  BASELODE_DARK_TEMPLATE,
  LITHOLOGY_COLOURS,
} from 'baselode';
import { useProjectData } from '../context/ProjectDataContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import './AnalyticsPlots.css';

// Columns that always describe row geometry / source rather than
// something to plot — auto-detection skips them.
const RESERVED_FOR_ANALYTICS = new Set([
  'hole_id', 'from', 'to', 'mid', 'depth', '_source',
  'sample_id', 'datasource_sample_id', 'datasource_surface_sample_id',
  'datasource_hole_id', 'collar_id', 'report_number',
]);

function flattenAssayRows(combinedHoles) {
  const flattened = [];
  for (const hole of combinedHoles || []) {
    // parseUnifiedDataset returns `{ holeId, points }` per hole, with
    // each point tagged `_source: 'assay' | 'structural' | 'geology'`.
    const holeId = hole?.holeId ?? hole?.id ?? hole?.hole_id;
    const points = hole?.points ?? hole?.rows ?? [];
    for (const row of points) {
      if (!row || row._source !== 'assay') continue;
      // Spread first then set hole_id, so any hole_id already on the
      // row can't override the value we normalized from the hole.
      flattened.push({ ...row, hole_id: holeId });
    }
  }
  return flattened;
}

function detectNumericColumns(rows) {
  if (!rows.length) return [];
  const counts = new Map();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (RESERVED_FOR_ANALYTICS.has(key)) continue;
      // Skip nullish + blanks explicitly: Number('') is 0, which would
      // falsely classify blank-string columns as numeric.
      if (value == null) continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
}

function detectCategoricalColumns(rows) {
  if (!rows.length) return [];
  const candidates = new Map();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (RESERVED_FOR_ANALYTICS.has(key)) continue;
      if (value == null || value === '') continue;
      if (Number.isFinite(Number(value))) continue;
      if (!candidates.has(key)) candidates.set(key, new Set());
      candidates.get(key).add(String(value));
    }
  }
  return [...candidates.entries()]
    .filter(([, distinct]) => distinct.size > 1 && distinct.size <= 40)
    .sort((a, b) => a[1].size - b[1].size)
    .map(([key]) => key);
}

function PlotPanel({ title, description, controls, data, layout, height = 380 }) {
  const containerRef = useRef(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    Plotly.react(container, data || [], { autosize: true, ...layout, height }, {
      responsive: true,
      displayModeBar: 'hover',
    });
    return () => {
      try { Plotly.purge(container); } catch (_) { /* unmounted */ }
    };
  }, [data, layout, height]);
  return (
    <section className="plot-panel">
      <header className="plot-panel__header">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      {controls && <div className="plot-panel__controls">{controls}</div>}
      <div ref={containerRef} className="plot-panel__chart" style={{ height: `${height}px` }} />
    </section>
  );
}

function LogToggle({ label, value, onChange }) {
  return (
    <label className="log-toggle">
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function BarmodeSelect({ value, onChange }) {
  return (
    <label className="prop-select">
      <span>stack</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="overlay">in z (overlay)</option>
        <option value="stack">in y (stacked)</option>
        <option value="group">side-by-side</option>
      </select>
    </label>
  );
}

function PropertySelect({ label, value, onChange, options, includeBlank = false }) {
  // Render the dropdown alphabetically (case-insensitive) so the list is
  // scannable.  Upstream column ordering is preserved for default picking
  // via frequency.
  const sortedOptions = [...options].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { sensitivity: 'base' })
  );
  return (
    <label className="prop-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {includeBlank && <option value="">(none)</option>}
        {sortedOptions.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function SourceToggle({ source, setSource, options }) {
  return (
    <div className="source-toggle" role="radiogroup" aria-label="Data source">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={source === option.key}
          className={source === option.key ? 'source-toggle__btn source-toggle__btn--active' : 'source-toggle__btn'}
          onClick={() => setSource(option.key)}
        >
          {option.label}
          <span className="source-toggle__count">{option.rowCount.toLocaleString()} rows</span>
        </button>
      ))}
    </div>
  );
}

function AnalyticsPlots() {
  const { status, combinedHoles, surfaceSamples } = useProjectData();
  const { theme } = useTheme();
  const useDarkTemplate = theme === 'dark';

  const assayRows = useMemo(() => flattenAssayRows(combinedHoles), [combinedHoles]);
  const surfaceRows = useMemo(() => surfaceSamples || [], [surfaceSamples]);

  const sources = useMemo(() => {
    const out = [];
    if (assayRows.length) {
      out.push({ key: 'assays', label: 'Drillhole assays', rows: assayRows, rowCount: assayRows.length });
    }
    if (surfaceRows.length) {
      out.push({
        key: 'surface_samples', label: 'Surface samples', rows: surfaceRows, rowCount: surfaceRows.length,
      });
    }
    return out;
  }, [assayRows, surfaceRows]);

  const [source, setSource] = useState('');
  useEffect(() => {
    if (!source && sources.length) setSource(sources[0].key);
  }, [source, sources]);

  const activeSource = sources.find((entry) => entry.key === source) || sources[0];
  const activeRows = activeSource?.rows || [];

  const numericColumns = useMemo(() => detectNumericColumns(activeRows), [activeRows]);
  const categoricalColumns = useMemo(() => detectCategoricalColumns(activeRows), [activeRows]);

  const defaultColorBy = useMemo(() => {
    if (!categoricalColumns.length) return undefined;
    const preferOrder = ['lithology', 'surface_sample_type', 'project_id'];
    for (const preferred of preferOrder) {
      const hit = categoricalColumns.find((column) => column.toLowerCase().includes(preferred));
      if (hit) return hit;
    }
    return categoricalColumns[0];
  }, [categoricalColumns]);

  // Per-plot state — scatter
  const [scatterX, setScatterX] = useState('');
  const [scatterY, setScatterY] = useState('');
  const [scatterColorBy, setScatterColorBy] = useState('');
  const [scatterLogX, setScatterLogX] = useState(true);
  const [scatterLogY, setScatterLogY] = useState(true);

  // Per-plot state — histogram (Y-only log; X is the binned analyte)
  const [histProp, setHistProp] = useState('');
  const [histGroupBy, setHistGroupBy] = useState('');
  const [histLogY, setHistLogY] = useState(true);
  const [histBarmode, setHistBarmode] = useState('overlay');

  // Per-plot state — box / violin (value axis is Y, X is the categorical group)
  const [boxProp, setBoxProp] = useState('');
  const [boxGroupBy, setBoxGroupBy] = useState('');
  const [boxLogY, setBoxLogY] = useState(true);
  const [violinProp, setViolinProp] = useState('');
  const [violinGroupBy, setViolinGroupBy] = useState('');
  const [violinLogY, setViolinLogY] = useState(true);

  // Per-plot state — ternary (no log — components are percentages)
  const [aProp, setAProp] = useState('');
  const [bProp, setBProp] = useState('');
  const [cProp, setCProp] = useState('');
  const [ternaryColorBy, setTernaryColorBy] = useState('');

  // Reset prop selections when the source changes — the new source may
  // not carry the previously-picked columns.
  useEffect(() => {
    setScatterX(''); setScatterY(''); setScatterColorBy('');
    setHistProp(''); setHistGroupBy('');
    setBoxProp(''); setBoxGroupBy('');
    setViolinProp(''); setViolinGroupBy('');
    setAProp(''); setBProp(''); setCProp(''); setTernaryColorBy('');
  }, [source]);

  // Seed per-plot column picks once columns are known.  Subsequent
  // column changes don't overwrite a user's explicit pick.
  useEffect(() => {
    if (!numericColumns.length) return;
    const get = (idx) => numericColumns[Math.min(idx, numericColumns.length - 1)];
    setScatterX((current) => current || get(0));
    setScatterY((current) => current || get(1));
    setHistProp((current) => current || get(0));
    setBoxProp((current) => current || get(0));
    setViolinProp((current) => current || get(0));
    setAProp((current) => current || get(0));
    setBProp((current) => current || get(1));
    setCProp((current) => current || get(2));
  }, [numericColumns]);

  useEffect(() => {
    if (!defaultColorBy) return;
    setScatterColorBy((current) => current || defaultColorBy);
    setHistGroupBy((current) => current || defaultColorBy);
    setBoxGroupBy((current) => current || defaultColorBy);
    setViolinGroupBy((current) => current || defaultColorBy);
    setTernaryColorBy((current) => current || defaultColorBy);
  }, [defaultColorBy]);

  const template = useDarkTemplate ? BASELODE_DARK_TEMPLATE : BASELODE_TEMPLATE;
  const colourMap = categoricalColumns.some((column) => column.toLowerCase().includes('litho'))
    ? LITHOLOGY_COLOURS
    : null;

  const scatter = useMemo(() => buildScatterPlotConfig(activeRows, {
    xProp: scatterX, yProp: scatterY, colorBy: scatterColorBy, colourMap,
    log: { x: scatterLogX, y: scatterLogY }, template,
  }), [activeRows, scatterX, scatterY, scatterColorBy, scatterLogX, scatterLogY, colourMap, template]);

  const histogram = useMemo(() => buildHistogramPlotConfig(activeRows, {
    prop: histProp, groupBy: histGroupBy, colourMap,
    log: histLogY, barmode: histBarmode, template,
  }), [activeRows, histProp, histGroupBy, histLogY, histBarmode, colourMap, template]);

  const box = useMemo(() => buildBoxPlotConfig(activeRows, {
    prop: boxProp, groupBy: boxGroupBy, colourMap, log: boxLogY, template,
  }), [activeRows, boxProp, boxGroupBy, boxLogY, colourMap, template]);

  const violin = useMemo(() => buildViolinPlotConfig(activeRows, {
    prop: violinProp, groupBy: violinGroupBy, colourMap, log: violinLogY, template,
  }), [activeRows, violinProp, violinGroupBy, violinLogY, colourMap, template]);

  const ternary = useMemo(() => buildTernaryPlotConfig(activeRows, {
    aProp, bProp, cProp, colorBy: ternaryColorBy, colourMap, template,
  }), [activeRows, aProp, bProp, cProp, ternaryColorBy, colourMap, template]);

  const hasCategoricals = categoricalColumns.length > 0;

  if (status !== 'ready') {
    return (
      <div className="analytics-page">
        <header className="analytics-page__header">
          <div>
            <h1>Analytics Plots</h1>
            <p>Open a project folder from the sidebar to load assay or surface sample data, then return here.</p>
          </div>
        </header>
        <p className="analytics-status">
          No project loaded.{' '}
          <Link to="/data-instructions">See the project format docs →</Link>
        </p>
      </div>
    );
  }

  if (!sources.length) {
    return (
      <div className="analytics-page">
        <header className="analytics-page__header">
          <div>
            <h1>Analytics Plots</h1>
            <p>The loaded project doesn't carry plottable data.</p>
          </div>
        </header>
        <p className="analytics-status">
          Add an <code>assays.csv</code> / <code>assays.parquet</code> or a{' '}
          <code>surface_samples.csv</code> / <code>surface_samples.parquet</code>{' '}
          to your project folder to enable this page.{' '}
          <Link to="/data-instructions">Project format →</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="analytics-page">
      <header className="analytics-page__header">
        <div>
          <h1>Analytics Plots</h1>
          <p>
            Analyte-vs-analyte exploration on the loaded project.  Plot primitives from{' '}
            <code>baselode</code>: <code>buildScatterPlotConfig</code>,{' '}
            <code>buildHistogramPlotConfig</code>,{' '}
            <code>buildBoxPlotConfig</code>,{' '}
            <code>buildViolinPlotConfig</code>,{' '}
            <code>buildTernaryPlotConfig</code>.
          </p>
        </div>
      </header>

      <SourceToggle source={source} setSource={setSource} options={sources} />

      <PlotPanel
        title="Scatter"
        description="Analyte vs analyte with optional categorical colour-by."
        controls={(
          <>
            <PropertySelect label="X" value={scatterX} onChange={setScatterX} options={numericColumns} />
            <PropertySelect label="Y" value={scatterY} onChange={setScatterY} options={numericColumns} />
            {hasCategoricals && (
              <PropertySelect
                label="Colour by"
                value={scatterColorBy}
                onChange={setScatterColorBy}
                options={categoricalColumns}
                includeBlank
              />
            )}
            <LogToggle label="log X" value={scatterLogX} onChange={setScatterLogX} />
            <LogToggle label="log Y" value={scatterLogY} onChange={setScatterLogY} />
          </>
        )}
        data={scatter.data}
        layout={scatter.layout}
      />

      <PlotPanel
        title="Histogram"
        description="Distribution per group overlaid."
        controls={(
          <>
            <PropertySelect label="Property" value={histProp} onChange={setHistProp} options={numericColumns} />
            {hasCategoricals && (
              <PropertySelect
                label="Group by"
                value={histGroupBy}
                onChange={setHistGroupBy}
                options={categoricalColumns}
                includeBlank
              />
            )}
            <LogToggle label="log Y" value={histLogY} onChange={setHistLogY} />
            {histGroupBy && (
              <BarmodeSelect value={histBarmode} onChange={setHistBarmode} />
            )}
          </>
        )}
        data={histogram.data}
        layout={histogram.layout}
      />

      <div className="analytics-grid">
        <PlotPanel
          title="Box"
          description="Quartiles per group, outliers shown."
          controls={(
            <>
              <PropertySelect label="Property" value={boxProp} onChange={setBoxProp} options={numericColumns} />
              {hasCategoricals && (
                <PropertySelect
                  label="Group by"
                  value={boxGroupBy}
                  onChange={setBoxGroupBy}
                  options={categoricalColumns}
                  includeBlank
                />
              )}
              <LogToggle label="log Y" value={boxLogY} onChange={setBoxLogY} />
            </>
          )}
          data={box.data}
          layout={box.layout}
          height={360}
        />
        <PlotPanel
          title="Violin"
          description="Distribution shape per group, inner box + mean line."
          controls={(
            <>
              <PropertySelect label="Property" value={violinProp} onChange={setViolinProp} options={numericColumns} />
              {hasCategoricals && (
                <PropertySelect
                  label="Group by"
                  value={violinGroupBy}
                  onChange={setViolinGroupBy}
                  options={categoricalColumns}
                  includeBlank
                />
              )}
              <LogToggle label="log Y" value={violinLogY} onChange={setViolinLogY} />
            </>
          )}
          data={violin.data}
          layout={violin.layout}
          height={360}
        />
      </div>

      <PlotPanel
        title="Ternary"
        description="Three-component composition.  Plotly auto-normalises components to 100."
        controls={(
          <>
            <PropertySelect label="A" value={aProp} onChange={setAProp} options={numericColumns} />
            <PropertySelect label="B" value={bProp} onChange={setBProp} options={numericColumns} />
            <PropertySelect label="C" value={cProp} onChange={setCProp} options={numericColumns} />
            {hasCategoricals && (
              <PropertySelect
                label="Colour by"
                value={ternaryColorBy}
                onChange={setTernaryColorBy}
                options={categoricalColumns}
                includeBlank
              />
            )}
          </>
        )}
        data={ternary.data}
        layout={ternary.layout}
        height={480}
      />
    </div>
  );
}

export default AnalyticsPlots;
