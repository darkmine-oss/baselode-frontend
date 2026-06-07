/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Plotly from 'plotly.js-dist-min';
// Namespace import — the analytics primitives ship in baselode >= 0.1.30.
// A named import would hard-error at build time when an older package is
// installed; the runtime guard below shows an upgrade notice instead.
import * as baselode from 'baselode';
import { useProjectData } from '../context/ProjectDataContext.jsx';
import './AnalyticsPlots.css';

const {
  buildScatterPlotConfig,
  buildHistogramPlotConfig,
  buildBoxPlotConfig,
  buildViolinPlotConfig,
  buildTernaryPlotConfig,
  BASELODE_TEMPLATE,
  BASELODE_DARK_TEMPLATE,
  LITHOLOGY_COLOURS,
} = baselode;

const HAS_ANALYTICS_PRIMITIVES = (
  typeof buildScatterPlotConfig === 'function'
  && typeof buildHistogramPlotConfig === 'function'
  && typeof buildBoxPlotConfig === 'function'
  && typeof buildViolinPlotConfig === 'function'
  && typeof buildTernaryPlotConfig === 'function'
);

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

function PlotPanel({ title, description, data, layout, height = 380 }) {
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
      <div ref={containerRef} className="plot-panel__chart" style={{ height: `${height}px` }} />
    </section>
  );
}

function PropertySelect({ label, value, onChange, options }) {
  return (
    <label className="prop-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
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
  const [useDarkTemplate, setUseDarkTemplate] = useState(false);

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

  const [xProp, setXProp] = useState('');
  const [yProp, setYProp] = useState('');
  const [distProp, setDistProp] = useState('');
  const [groupBy, setGroupBy] = useState('');
  const [aProp, setAProp] = useState('');
  const [bProp, setBProp] = useState('');
  const [cProp, setCProp] = useState('');

  // Reset prop selections when the source changes — the new source may not carry the previously-picked columns.
  useEffect(() => {
    setXProp('');
    setYProp('');
    setDistProp('');
    setGroupBy('');
    setAProp('');
    setBProp('');
    setCProp('');
  }, [source]);

  useEffect(() => {
    if (!numericColumns.length) return;
    if (!xProp) setXProp(numericColumns[0]);
    if (!yProp) setYProp(numericColumns[Math.min(1, numericColumns.length - 1)] || numericColumns[0]);
    if (!distProp) setDistProp(numericColumns[0]);
    if (!aProp) setAProp(numericColumns[0]);
    if (!bProp) setBProp(numericColumns[Math.min(1, numericColumns.length - 1)] || numericColumns[0]);
    if (!cProp) setCProp(numericColumns[Math.min(2, numericColumns.length - 1)] || numericColumns[0]);
  }, [numericColumns, xProp, yProp, distProp, aProp, bProp, cProp]);

  useEffect(() => {
    if (!groupBy && defaultColorBy) setGroupBy(defaultColorBy);
  }, [defaultColorBy, groupBy]);

  const template = useDarkTemplate ? BASELODE_DARK_TEMPLATE : BASELODE_TEMPLATE;
  const colourMap = categoricalColumns.some((column) => column.toLowerCase().includes('litho'))
    ? LITHOLOGY_COLOURS
    : null;

  const scatter = useMemo(() => buildScatterPlotConfig(activeRows, {
    xProp, yProp, colorBy: groupBy, colourMap, log: { x: true, y: true }, template,
  }), [activeRows, xProp, yProp, groupBy, colourMap, template]);

  const histogram = useMemo(() => buildHistogramPlotConfig(activeRows, {
    prop: distProp, groupBy, colourMap, log: true, template,
  }), [activeRows, distProp, groupBy, colourMap, template]);

  const box = useMemo(() => buildBoxPlotConfig(activeRows, {
    prop: distProp, groupBy, colourMap, log: true, template,
  }), [activeRows, distProp, groupBy, colourMap, template]);

  const violin = useMemo(() => buildViolinPlotConfig(activeRows, {
    prop: distProp, groupBy, colourMap, log: true, template,
  }), [activeRows, distProp, groupBy, colourMap, template]);

  const ternary = useMemo(() => buildTernaryPlotConfig(activeRows, {
    aProp, bProp, cProp, colorBy: groupBy, colourMap, template,
  }), [activeRows, aProp, bProp, cProp, groupBy, colourMap, template]);

  if (!HAS_ANALYTICS_PRIMITIVES) {
    return (
      <div className="analytics-page">
        <header className="analytics-page__header">
          <div>
            <h1>Analytics Plots</h1>
            <p>This view needs <code>baselode &gt;= 0.1.30</code> for the analytics plot primitives.</p>
          </div>
        </header>
        <p className="analytics-status">
          The installed <code>baselode</code> doesn't export <code>buildScatterPlotConfig</code> /{' '}
          <code>buildHistogramPlotConfig</code> / etc. yet.  Update <code>package.json</code>{' '}
          and run <code>npm install</code> once that version is published, then come back here.
        </p>
      </div>
    );
  }

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
    <div className={`analytics-page ${useDarkTemplate ? 'analytics-page--dark' : ''}`}>
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
        <label className="dark-toggle">
          <input
            type="checkbox"
            checked={useDarkTemplate}
            onChange={(event) => setUseDarkTemplate(event.target.checked)}
          />
          <span>Dark template</span>
        </label>
      </header>

      <SourceToggle source={source} setSource={setSource} options={sources} />

      <div className="analytics-controls">
        <PropertySelect label="Scatter X" value={xProp} onChange={setXProp} options={numericColumns} />
        <PropertySelect label="Scatter Y" value={yProp} onChange={setYProp} options={numericColumns} />
        <PropertySelect label="Distribution prop" value={distProp} onChange={setDistProp} options={numericColumns} />
        {categoricalColumns.length > 0 && (
          <PropertySelect label="Group / colour by" value={groupBy} onChange={setGroupBy} options={categoricalColumns} />
        )}
        <PropertySelect label="Ternary A" value={aProp} onChange={setAProp} options={numericColumns} />
        <PropertySelect label="Ternary B" value={bProp} onChange={setBProp} options={numericColumns} />
        <PropertySelect label="Ternary C" value={cProp} onChange={setCProp} options={numericColumns} />
      </div>

      <PlotPanel
        title={`Scatter — ${xProp} vs ${yProp}`}
        description={`Coloured by "${groupBy || '(none)'}", log axes on both X and Y.`}
        data={scatter.data}
        layout={scatter.layout}
      />

      <PlotPanel
        title={`Histogram — ${distProp}`}
        description={`Overlay grouped by "${groupBy || '(none)'}", log Y.`}
        data={histogram.data}
        layout={histogram.layout}
      />

      <div className="analytics-grid">
        <PlotPanel
          title={`Box — ${distProp} per ${groupBy || '(set)'}`}
          description="Outliers shown, log Y."
          data={box.data}
          layout={box.layout}
          height={360}
        />
        <PlotPanel
          title={`Violin — ${distProp} per ${groupBy || '(set)'}`}
          description="Inner box + mean line, log Y."
          data={violin.data}
          layout={violin.layout}
          height={360}
        />
      </div>

      <PlotPanel
        title={`Ternary — ${aProp} · ${bProp} · ${cProp}`}
        description={`Coloured by "${groupBy || '(none)'}".  Plotly auto-normalises components to 100.`}
        data={ternary.data}
        layout={ternary.layout}
        height={480}
      />
    </div>
  );
}

export default AnalyticsPlots;
