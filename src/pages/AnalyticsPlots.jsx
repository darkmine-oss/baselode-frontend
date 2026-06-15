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
import { useAnalyticsSelections } from '../context/AnalyticsSelectionsContext.jsx';
import './AnalyticsPlots.css';

// Columns that always describe row geometry / source rather than
// something to plot — auto-detection skips them.
const RESERVED_FOR_ANALYTICS = new Set([
  'hole_id', 'from', 'to', 'mid', 'depth', '_source',
  'sample_id', 'datasource_sample_id', 'datasource_surface_sample_id',
  'datasource_hole_id', 'collar_id', 'report_number',
]);

const NON_WEBGL_TRACE_TYPES = {
  scattergl: 'scatter',
  heatmapgl: 'heatmap',
  scatterpolargl: 'scatterpolar',
  pointcloud: 'scatter',
};

function withoutWebGlTraces(data) {
  return (data || []).map((trace) => {
    const fallbackType = NON_WEBGL_TRACE_TYPES[trace?.type];
    return fallbackType ? { ...trace, type: fallbackType } : trace;
  });
}

function plotErrorMessage(error) {
  const detail = error?.message || String(error || '');
  if (/webgl|web gl|gl2d|regl/i.test(detail)) {
    return 'This chart could not be rendered because the embedded browser did not provide WebGL. The analytics page now prefers non-WebGL traces, but this plot still failed.';
  }
  return detail ? `Plot render failed: ${detail}` : 'Plot render failed.';
}

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
  // Per column track distinct values + how many were numeric.  A
  // column is categorical if (a) it has 2–40 distinct values and
  // (b) at least half of populated values are non-numeric.  The
  // "majority-non-numeric" rule lets columns like `geology_code` —
  // where most rows are strings but a few are integers — through,
  // which the strict all-non-numeric rule would reject.
  const stats = new Map();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (RESERVED_FOR_ANALYTICS.has(key)) continue;
      if (value == null) continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      if (!stats.has(key)) stats.set(key, { distinct: new Set(), numeric: 0, total: 0 });
      const entry = stats.get(key);
      entry.distinct.add(String(value));
      entry.total += 1;
      if (Number.isFinite(Number(value))) entry.numeric += 1;
    }
  }
  return [...stats.entries()]
    .filter(([, entry]) => {
      const distinct = entry.distinct.size;
      if (distinct < 2 || distinct > 40) return false;
      // Majority non-numeric — flips false for analyte columns (all
      // numeric) but keeps geology_code / hole_type / lithology even
      // when a handful of rows happen to parse as numbers.
      return entry.numeric * 2 <= entry.total;
    })
    .sort((a, b) => a[1].distinct.size - b[1].distinct.size)
    .map(([key]) => key);
}

function PlotPanel({ title, description, controls, data, layout, height = 380 }) {
  const containerRef = useRef(null);
  const [renderError, setRenderError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return undefined;
    const render = async () => {
      try {
        await Plotly.react(container, withoutWebGlTraces(data), { autosize: true, ...layout, height }, {
          responsive: true,
          displayModeBar: 'hover',
        });
        if (!cancelled) setRenderError('');
      } catch (error) {
        console.warn(`${title} plot render failed`, error);
        if (!cancelled) setRenderError(plotErrorMessage(error));
      }
    };
    render();
    return () => {
      cancelled = true;
      try { Plotly.purge(container); } catch (_) { /* unmounted */ }
    };
  }, [data, layout, height, title]);
  return (
    <section className="plot-panel">
      <header className="plot-panel__header">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      {controls && <div className="plot-panel__controls">{controls}</div>}
      <div ref={containerRef} className="plot-panel__chart" style={{ height: `${height}px` }} />
      {renderError && <p className="plot-panel__error">{renderError}</p>}
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

  // Picks live in a layout-level context so navigating away and back
  // doesn't reset what the user has chosen.
  const { selections, setSource, setPlot } = useAnalyticsSelections();
  const { source, scatter, histogram, box, violin, ternary } = selections;

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

  useEffect(() => {
    if (!source && sources.length) setSource(sources[0].key);
  }, [source, sources, setSource]);

  const activeSource = sources.find((entry) => entry.key === source) || sources[0];
  // Memoise — without this `[]` is a new array every render, which
  // would make numericColumns / categoricalColumns change identity
  // on every render and re-fire the seed/colour effects in a loop
  // whenever the page is in the "no plottable data" state.
  const activeRows = useMemo(() => activeSource?.rows || [], [activeSource]);

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

  // Self-healing column picks: validate every per-plot column against
  // the current `numericColumns` and replace stale or empty picks with
  // a sensible default.  This runs in one effect so a source change
  // can't race a separate reset effect (the previous incarnation
  // wiped the seeded picks one render after seeding them, leaving
  // the page stuck on empty dropdowns until the user touched one).
  useEffect(() => {
    if (!numericColumns.length) return;
    const valid = new Set(numericColumns);
    const get = (idx) => numericColumns[Math.min(idx, numericColumns.length - 1)];
    const pick = (value, fallbackIdx) => (valid.has(value) ? value : get(fallbackIdx));
    setPlot('scatter', (current) => ({
      x: pick(current.x, 0),
      y: pick(current.y, 1),
    }));
    setPlot('histogram', (current) => ({ prop: pick(current.prop, 0) }));
    setPlot('box', (current) => ({ prop: pick(current.prop, 0) }));
    setPlot('violin', (current) => ({ prop: pick(current.prop, 0) }));
    setPlot('ternary', (current) => ({
      a: pick(current.a, 0),
      b: pick(current.b, 1),
      c: pick(current.c, 2),
    }));
  }, [numericColumns, setPlot]);

  // Colour-by picks: validate against the categorical column set.  An
  // empty cache value falls through to `defaultColorBy`; a stale value
  // (column no longer present) falls back to `defaultColorBy` too.
  useEffect(() => {
    const valid = new Set(categoricalColumns);
    const pick = (value) => (valid.has(value) ? value : (defaultColorBy || ''));
    setPlot('scatter', (current) => ({ colorBy: pick(current.colorBy) }));
    setPlot('histogram', (current) => ({ groupBy: pick(current.groupBy) }));
    setPlot('box', (current) => ({ groupBy: pick(current.groupBy) }));
    setPlot('violin', (current) => ({ groupBy: pick(current.groupBy) }));
    setPlot('ternary', (current) => ({ colorBy: pick(current.colorBy) }));
  }, [categoricalColumns, defaultColorBy, setPlot]);

  const template = useDarkTemplate ? BASELODE_DARK_TEMPLATE : BASELODE_TEMPLATE;
  const colourMap = categoricalColumns.some((column) => column.toLowerCase().includes('litho'))
    ? LITHOLOGY_COLOURS
    : null;

  const scatterConfig = useMemo(() => buildScatterPlotConfig(activeRows, {
    xProp: scatter.x, yProp: scatter.y, colorBy: scatter.colorBy, colourMap,
    log: { x: scatter.logX, y: scatter.logY }, template,
  }), [activeRows, scatter, colourMap, template]);

  const histogramConfig = useMemo(() => buildHistogramPlotConfig(activeRows, {
    prop: histogram.prop, groupBy: histogram.groupBy, colourMap,
    log: histogram.logY, barmode: histogram.barmode, template,
  }), [activeRows, histogram, colourMap, template]);

  const boxConfig = useMemo(() => buildBoxPlotConfig(activeRows, {
    prop: box.prop, groupBy: box.groupBy, colourMap, log: box.logY, template,
  }), [activeRows, box, colourMap, template]);

  const violinConfig = useMemo(() => buildViolinPlotConfig(activeRows, {
    prop: violin.prop, groupBy: violin.groupBy, colourMap, log: violin.logY, template,
  }), [activeRows, violin, colourMap, template]);

  const ternaryConfig = useMemo(() => buildTernaryPlotConfig(activeRows, {
    aProp: ternary.a, bProp: ternary.b, cProp: ternary.c, colorBy: ternary.colorBy, colourMap, template,
  }), [activeRows, ternary, colourMap, template]);

  if (status !== 'ready') {
    return (
      <div className="analytics-page">
        <p className="analytics-status">
          No project loaded.  Open a project folder from the sidebar to load assay or surface sample data, then return here.{' '}
          <Link to="/data-instructions">See the project format docs →</Link>
        </p>
      </div>
    );
  }

  if (!sources.length) {
    return (
      <div className="analytics-page">
        <p className="analytics-status">
          The loaded project doesn't carry plottable data.  Add an{' '}
          <code>assays.csv</code> / <code>assays.parquet</code> or a{' '}
          <code>surface_samples.csv</code> / <code>surface_samples.parquet</code>{' '}
          to your project folder to enable this page.{' '}
          <Link to="/data-instructions">Project format →</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="analytics-page">
      <SourceToggle source={source} setSource={setSource} options={sources} />

      <PlotPanel
        title="Scatter"
        description="Analyte vs analyte with optional categorical colour-by."
        controls={(
          <>
            <PropertySelect label="X" value={scatter.x} onChange={(x) => setPlot('scatter', { x })} options={numericColumns} />
            <PropertySelect label="Y" value={scatter.y} onChange={(y) => setPlot('scatter', { y })} options={numericColumns} />
            <PropertySelect
              label="Colour by"
              value={scatter.colorBy}
              onChange={(colorBy) => setPlot('scatter', { colorBy })}
              options={categoricalColumns}
              includeBlank
            />
            <LogToggle label="log X" value={scatter.logX} onChange={(logX) => setPlot('scatter', { logX })} />
            <LogToggle label="log Y" value={scatter.logY} onChange={(logY) => setPlot('scatter', { logY })} />
          </>
        )}
        data={scatterConfig.data}
        layout={scatterConfig.layout}
      />

      <PlotPanel
        title="Histogram"
        description="Distribution per group overlaid."
        controls={(
          <>
            <PropertySelect label="Property" value={histogram.prop} onChange={(prop) => setPlot('histogram', { prop })} options={numericColumns} />
            <PropertySelect
              label="Group by"
              value={histogram.groupBy}
              onChange={(groupBy) => setPlot('histogram', { groupBy })}
              options={categoricalColumns}
              includeBlank
            />
            <LogToggle label="log Y" value={histogram.logY} onChange={(logY) => setPlot('histogram', { logY })} />
            {histogram.groupBy && (
              <BarmodeSelect value={histogram.barmode} onChange={(barmode) => setPlot('histogram', { barmode })} />
            )}
          </>
        )}
        data={histogramConfig.data}
        layout={histogramConfig.layout}
      />

      <div className="analytics-grid">
        <PlotPanel
          title="Box"
          description="Quartiles per group, outliers shown."
          controls={(
            <>
              <PropertySelect label="Property" value={box.prop} onChange={(prop) => setPlot('box', { prop })} options={numericColumns} />
              <PropertySelect
                label="Group by"
                value={box.groupBy}
                onChange={(groupBy) => setPlot('box', { groupBy })}
                options={categoricalColumns}
                includeBlank
              />
              <LogToggle label="log Y" value={box.logY} onChange={(logY) => setPlot('box', { logY })} />
            </>
          )}
          data={boxConfig.data}
          layout={boxConfig.layout}
          height={360}
        />
        <PlotPanel
          title="Violin"
          description="Distribution shape per group, inner box + mean line."
          controls={(
            <>
              <PropertySelect label="Property" value={violin.prop} onChange={(prop) => setPlot('violin', { prop })} options={numericColumns} />
              <PropertySelect
                label="Group by"
                value={violin.groupBy}
                onChange={(groupBy) => setPlot('violin', { groupBy })}
                options={categoricalColumns}
                includeBlank
              />
              <LogToggle label="log Y" value={violin.logY} onChange={(logY) => setPlot('violin', { logY })} />
            </>
          )}
          data={violinConfig.data}
          layout={violinConfig.layout}
          height={360}
        />
      </div>

      <PlotPanel
        title="Ternary"
        description="Three-component composition.  Plotly auto-normalises components to 100."
        controls={(
          <>
            <PropertySelect label="A" value={ternary.a} onChange={(a) => setPlot('ternary', { a })} options={numericColumns} />
            <PropertySelect label="B" value={ternary.b} onChange={(b) => setPlot('ternary', { b })} options={numericColumns} />
            <PropertySelect label="C" value={ternary.c} onChange={(c) => setPlot('ternary', { c })} options={numericColumns} />
            <PropertySelect
              label="Colour by"
              value={ternary.colorBy}
              onChange={(colorBy) => setPlot('ternary', { colorBy })}
              options={categoricalColumns}
              includeBlank
            />
          </>
        )}
        data={ternaryConfig.data}
        layout={ternaryConfig.layout}
        height={480}
      />
    </div>
  );
}

export default AnalyticsPlots;
