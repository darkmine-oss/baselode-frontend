/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  TracePlot,
  useDrillholeTraceGrid,
  BASELODE_DARK_TEMPLATE,
  BASELODE_LIGHT_TEMPLATE,
} from 'baselode';
import './Drillhole2D.css';
import { useProjectData } from '../context/ProjectDataContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';

const PLOT_COUNT_KEY = 'baselode-viewer-strip-log-plot-count-v1';
const PLOT_COUNT_MIN = 1;
const PLOT_COUNT_MAX = 16;
const PLOT_COUNT_DEFAULT = 4;

function clampPlotCount(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return PLOT_COUNT_DEFAULT;
  return Math.min(PLOT_COUNT_MAX, Math.max(PLOT_COUNT_MIN, v));
}

function readInitialPlotCount() {
  try {
    const v = localStorage.getItem(PLOT_COUNT_KEY);
    if (v != null) return clampPlotCount(v);
  } catch (e) { /* ignore */ }
  return PLOT_COUNT_DEFAULT;
}

function Drillhole2D() {
  const location = useLocation();
  const { theme } = useTheme();
  const { collars, combinedHoles, status } = useProjectData();

  // Both baselode templates (dark and the unnamed default used when no
  // template is passed) set hovermode: 'x unified', which makes categorical
  // strip logs (every text point at x=0.5) collapse into a single stacked
  // tooltip listing all intervals. Strip logs are y-axis (depth) oriented,
  // so 'closest' reads correctly for both categorical and numeric tracks.
  const template = useMemo(() => {
    const base = theme === 'dark' ? BASELODE_DARK_TEMPLATE : BASELODE_LIGHT_TEMPLATE;
    return {
      ...base,
      layout: { ...base.layout, hovermode: 'closest' },
    };
  }, [theme]);

  const [plotCount, setPlotCount] = useState(readInitialPlotCount);
  useEffect(() => {
    try { localStorage.setItem(PLOT_COUNT_KEY, String(plotCount)); } catch (e) { /* ignore */ }
  }, [plotCount]);

  // The hook's dropdown options are built only from holes in its internal
  // state, which is seeded from `extraHoles`. Pass a merged list: real
  // intervaled holes first (they have points), then stub entries for every
  // collar so all hole IDs appear in the picker even when they have no
  // downhole data.
  const extraHoles = useMemo(() => {
    const known = new Set((combinedHoles || []).map((h) => h?.id || h?.holeId).filter(Boolean));
    const stubs = (collars || [])
      .map((c) => c?.holeId)
      .filter((id) => id && !known.has(id))
      .map((id) => ({ id, holeId: id, points: [] }));
    return [...(combinedHoles || []), ...stubs];
  }, [collars, combinedHoles]);

  const {
    error,
    setError,
    holeCount,
    setFocusedHoleId,
    labeledHoleOptions,
    traceGraphs,
    handleConfigChange,
  } = useDrillholeTraceGrid({
    initialFocusedHoleId: location.state?.holeId || '',
    extraHoles,
    plotCount,
  });

  useEffect(() => {
    const holeIdFromNav = location.state?.holeId;
    if (holeIdFromNav) {
      setFocusedHoleId(holeIdFromNav);
      if (!holeCount) {
        setError((prev) => prev || `Loading data for hole ${holeIdFromNav}.`);
      }
    }
  }, [location.state, holeCount, setError, setFocusedHoleId]);

  const dataSourceTarget = typeof document !== 'undefined' ? document.getElementById('data-source-slot') : null;
  const dataSourceInfo = (
    <div className="data-source-text">
      {holeCount > 0 && <div>{holeCount} holes</div>}
    </div>
  );

  const controlsTarget = typeof document !== 'undefined' ? document.getElementById('strip-log-controls-slot') : null;
  const sidebarControls = (
    <div className="strip-log-controls">
      <div className="label-caps">Strip log</div>
      <label className="strip-log-control">
        <span>Plots</span>
        <input
          type="number"
          min={PLOT_COUNT_MIN}
          max={PLOT_COUNT_MAX}
          step={1}
          value={plotCount}
          onChange={(e) => setPlotCount(clampPlotCount(e.target.value))}
        />
      </label>
    </div>
  );

  return (
    <div className="drillhole2d-container">
      {error && (
        <div className="drillhole2d-header">
          <div className="drillhole2d-controls">
            <span className="error-text">{error}</span>
          </div>
        </div>
      )}

      {status !== 'ready' ? (
        <div className="page-empty-state">
          <h2>No project loaded</h2>
          <p>Open a project folder to view strip logs.</p>
        </div>
      ) : (
        <div className="plots-grid">
          {Array.from({ length: plotCount }).map((_, idx) => (
            <TracePlot
              key={idx}
              config={traceGraphs[idx]?.config || { holeId: '', property: '', chartType: 'markers+line' }}
              graph={traceGraphs[idx]}
              holeOptions={labeledHoleOptions}
              propertyOptions={traceGraphs[idx]?.propertyOptions || []}
              onConfigChange={(patch) => handleConfigChange(idx, patch)}
              template={template}
            />
          ))}
        </div>
      )}
      {dataSourceTarget && createPortal(dataSourceInfo, dataSourceTarget)}
      {controlsTarget && createPortal(sidebarControls, controlsTarget)}
    </div>
  );
}

export default Drillhole2D;
