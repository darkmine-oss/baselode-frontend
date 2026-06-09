/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Baselode3DScene,
  Baselode3DControls,
  parseDrillholesCSV,
  parseSurveyCSV,
  desurveyTraces,
  classifyColumns,
  getCategoryHexColor,
  COMMODITY_COLOURS,
} from 'baselode';
import 'baselode/style.css';
import './Drillhole.css';
import { useProjectData } from '../context/ProjectDataContext.jsx';
import { makeLocalProjector } from '../lib/localProjection.js';

// Sequential, perceptually uniform "magma"-style ramp (10 bins) — low values
// fade into the dark scene background, high values jump out as bright gold.
// Better for grade colour-by than the previous diverging RdYlBu palette,
// which wasted half its dynamic range on a meaningless mid-point.
const ASSAY_COLOR_PALETTE_10 = [
  '#1d1147',
  '#3b0f70',
  '#641a80',
  '#8c2981',
  '#b73779',
  '#de4968',
  '#f7705c',
  '#fe9f6d',
  '#fece91',
  '#fcfdbf',
];
const FOV_STEPS = [1, 4, 8, 14, 21, 28];
const CAMERA_CACHE_KEY = 'baselode-viewer-camera-v1';
const SCENE_BG_KEY = 'baselode-viewer-3d-dark-bg-v1';

function readInitialDarkBg() {
  try {
    const v = localStorage.getItem(SCENE_BG_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch (e) { /* ignore */ }
  return true; // dark by default for 3D viz
}

function Drillhole() {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const renderedHolesRef = useRef(null);
  const restoredCameraRef = useRef(false);
  const zoomSliderPrevRef = useRef(50);

  const { collars, assayState, structureRows, geologyHoles, rawCsv, status } = useProjectData();

  // Scene contains only holes the user has explicitly added via the sidebar.
  const [holes, setHoles] = useState([]);
  const [selectedHoleId, setSelectedHoleId] = useState('');
  const [addError, setAddError] = useState('');

  const [selectedHole, setSelectedHole] = useState(null);
  const [controlMode, setControlMode] = useState('orbit');
  const [error, setError] = useState('');
  const [colorByVariable, setColorByVariable] = useState('None');
  const [showStructuralDiscs, setShowStructuralDiscs] = useState(true);
  const [showStripLogs, setShowStripLogs] = useState(false);
  // Default to ~1/4 along the slider (closer to Ortho than full Perspective).
  const [perspectiveLevel, setPerspectiveLevel] = useState(1);
  const [darkBackground, setDarkBackground] = useState(readInitialDarkBg);

  useEffect(() => {
    try { localStorage.setItem(SCENE_BG_KEY, String(darkBackground)); } catch (e) { /* ignore */ }
  }, [darkBackground]);

  const sceneBackground = darkBackground ? 'black' : 'white';

  const assayVariables = useMemo(() => {
    const numeric = (assayState?.numericProps || []).filter(Boolean);
    return ['__HAS_ASSAY__', ...numeric];
  }, [assayState]);

  const geologyCategories = useMemo(() => {
    if (!geologyHoles?.length) return [];
    return classifyColumns(geologyHoles.flatMap((h) => h.points || [])).categoricalCols;
  }, [geologyHoles]);

  const isCategorical = useMemo(
    () => geologyCategories.includes(colorByVariable),
    [geologyCategories, colorByVariable]
  );

  const geologyCategoryIntervalsByHole = useMemo(() => {
    if (!isCategorical || !colorByVariable) return null;
    return buildCategoryIntervalsByHole(geologyHoles, colorByVariable);
  }, [isCategorical, geologyHoles, colorByVariable]);

  const assayIntervalsByHole = useMemo(
    () => buildAssayIntervalsByHole(assayState?.holes || []),
    [assayState]
  );

  const selectedAssayIntervalsByHole = useMemo(() => {
    if (colorByVariable === 'None' || isCategorical) return null;
    if (colorByVariable === '__HAS_ASSAY__') return assayIntervalsByHole;
    return mapIntervalsForVariable(assayIntervalsByHole, colorByVariable);
  }, [assayIntervalsByHole, colorByVariable, isCategorical]);

  const stripLogData = useMemo(() => {
    if (!showStripLogs || !holes?.length || !selectedAssayIntervalsByHole || isCategorical
      || colorByVariable === 'None' || colorByVariable === '__HAS_ASSAY__') return null;
    const allValues = Object.values(selectedAssayIntervalsByHole)
      .flatMap((ivs) => ivs.map((iv) => Number(iv.value)))
      .filter(Number.isFinite);
    const valueMin = allValues.length ? Math.min(...allValues) : null;
    const valueMax = allValues.length ? Math.max(...allValues) : null;
    const color = commodityColorForVariable(colorByVariable);
    const logs = holes.flatMap((hole) => {
      const key = normalizeHoleKey(hole.id);
      const intervals = selectedAssayIntervalsByHole[key];
      if (!intervals?.length) return [];
      const depths = intervals.map((iv) => (iv.from + iv.to) / 2);
      const values = intervals.map((iv) => Number(iv.value));
      if (values.filter(Number.isFinite).length < 2) return [];
      return [{ holeId: hole.id, depths, values, options: { color, valueMin, valueMax } }];
    });
    return logs.length ? logs : null;
  }, [showStripLogs, holes, selectedAssayIntervalsByHole, isCategorical, colorByVariable]);

  const legendScale = useMemo(() => {
    if (!selectedAssayIntervalsByHole || isCategorical || colorByVariable === '__HAS_ASSAY__') return null;
    const values = Object.values(selectedAssayIntervalsByHole)
      .flatMap((intervals) => (intervals || []).map((interval) => Number(interval?.value)))
      .filter(Number.isFinite);
    const scale = buildEqualRangeColorScale(values, ASSAY_COLOR_PALETTE_10);
    return scale?.bins?.length ? scale : null;
  }, [selectedAssayIntervalsByHole, colorByVariable, isCategorical]);

  // Parse survey rows once per project and keep them in memory; individual
  // hole adds re-use this and only desurvey the picked hole. baselode's
  // parseSurveyCSV is async, so we land it in state via useEffect.
  const [surveyRows, setSurveyRows] = useState(null);
  useEffect(() => {
    if (!rawCsv?.survey) {
      setSurveyRows(null);
      return undefined;
    }
    let cancelled = false;
    parseSurveyCSV(rawCsv.survey)
      .then((rows) => { if (!cancelled) setSurveyRows(rows?.length ? rows : null); })
      .catch((e) => {
        console.warn('Survey parse failed:', e);
        if (!cancelled) setSurveyRows(null);
      });
    return () => { cancelled = true; };
  }, [rawCsv?.survey]);

  // Precomputed desurveyed holes indexed by id (when the project supplies
  // a `precomputed_desurveyed` file). Adds prefer this over re-running the
  // desurvey when an entry exists. parseDrillholesCSV is also async.
  const [precomputedByHole, setPrecomputedByHole] = useState({});
  useEffect(() => {
    if (!rawCsv?.precomputed) {
      setPrecomputedByHole({});
      return undefined;
    }
    let cancelled = false;
    parseDrillholesCSV(rawCsv.precomputed)
      .then((parsed) => {
        if (cancelled) return;
        const out = {};
        (parsed?.holes || []).forEach((hole) => {
          const pts = (hole.points || []).map((p) => ({
            x: Number(p.x), y: Number(p.y), z: Number(p.z), md: Number(p.md),
          })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
          if (pts.length) {
            out[hole.id] = { id: hole.id, project: hole.points?.[0]?.project_id || '', points: pts };
          }
        });
        setPrecomputedByHole(out);
      })
      .catch((e) => {
        console.info('Precomputed desurvey parse failed:', e?.message);
        if (!cancelled) setPrecomputedByHole({});
      });
    return () => { cancelled = true; };
  }, [rawCsv?.precomputed]);

  // Fixed local-meters frame, centred on the collar centroid. We compute
  // this from ALL collars (not just the added ones) so the origin stays
  // stable as the user adds/removes holes — the scene doesn't shift under
  // the camera.
  const project = useMemo(() => {
    if (!collars.length) return null;
    const refLat = collars.reduce((s, c) => s + c.lat, 0) / collars.length;
    const refLng = collars.reduce((s, c) => s + c.lng, 0) / collars.length;
    return makeLocalProjector(refLat, refLng);
  }, [collars]);

  // Hole IDs that can actually be added to the scene: a collar plus at
  // least one survey row (or a precomputed entry). Holes without any
  // downhole geometry would otherwise produce nothing on Add.
  const allHoleIds = useMemo(() => {
    const surveySet = new Set();
    if (surveyRows) {
      for (const r of surveyRows) {
        if (r?.hole_id) surveySet.add(r.hole_id);
      }
    }
    const precSet = new Set(Object.keys(precomputedByHole));
    return Array.from(new Set(
      collars
        .map((c) => c.holeId)
        .filter((id) => id && (surveySet.has(id) || precSet.has(id)))
    )).sort();
  }, [collars, surveyRows, precomputedByHole]);

  // Reset scene-holes whenever the project changes underneath us. Without
  // this, leftover holes from a previous project would refuse to clear.
  useEffect(() => {
    setHoles([]);
    setAddError('');
    setError('');
    setSelectedHoleId('');
  }, [collars, rawCsv?.survey, rawCsv?.precomputed]);

  // De-dupe happens inside the functional updater so the latest state is
  // consulted, not whatever `holes` was in the closure when this callback
  // was created. That removes a TOCTOU window if Add is fired twice before
  // React commits the first append. As a bonus we can drop `holes` from
  // the deps so the callback stays referentially stable.
  const addHoleToScene = useCallback((holeId) => {
    if (!holeId) return;
    setAddError('');

    const appendIfNew = (entry) => {
      setHoles((prev) => (prev.some((h) => h.id === entry.id) ? prev : [...prev, entry]));
    };

    // 1) Precomputed wins.
    const pre = precomputedByHole[holeId];
    if (pre) {
      appendIfNew(pre);
      return;
    }

    // 2) Survey-based desurvey for just this one collar.
    if (!surveyRows) {
      setAddError(`No survey data available for ${holeId}.`);
      return;
    }
    if (!project) {
      setAddError('Local projection not ready (no collars).');
      return;
    }
    const collar = collars.find((c) => c.holeId === holeId);
    if (!collar) {
      setAddError(`Collar not found for ${holeId}.`);
      return;
    }
    let desurveyed;
    try {
      desurveyed = desurveyTraces([collar], surveyRows);
    } catch (e) {
      setAddError(e?.message || `Desurvey failed for ${holeId}.`);
      return;
    }
    if (!desurveyed?.length) {
      setAddError(`No survey rows match ${holeId}.`);
      return;
    }
    const h = desurveyed[0];
    const pts = (h.points || [])
      .map((p) => {
        const xy = project(p.lat ?? 0, p.lng ?? 0);
        if (!Number.isFinite(xy.x) || !Number.isFinite(xy.y) || !Number.isFinite(p.z)) return null;
        return { x: xy.x, y: xy.y, z: p.z, md: p.md };
      })
      .filter(Boolean);
    if (!pts.length) {
      setAddError(`No projectable points for ${holeId}.`);
      return;
    }
    appendIfNew({ id: h.id, project: h.project, points: pts });
  }, [collars, surveyRows, precomputedByHole, project]);

  const removeHoleFromScene = useCallback((holeId) => {
    setHoles((prev) => prev.filter((h) => h.id !== holeId));
  }, []);

  // Initialise scene once.
  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new Baselode3DScene();
    let viewSaveInterval = null;
    scene.init(containerRef.current);
    scene.setDrillholeClickHandler((meta) => setSelectedHole(meta));
    scene.setControlMode(controlMode);
    if (typeof scene.setViewChangeHandler === 'function') {
      scene.setViewChangeHandler((viewState) => saveCachedCameraView(viewState));
    } else {
      viewSaveInterval = window.setInterval(() => {
        const viewState = getSceneViewState(scene);
        if (viewState) saveCachedCameraView(viewState);
      }, 300);
    }
    const cachedView = loadCachedCameraView();
    if (cachedView) restoredCameraRef.current = setSceneViewState(scene, cachedView);
    sceneRef.current = scene;

    const handleResize = () => scene.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      if (viewSaveInterval) window.clearInterval(viewSaveInterval);
      const viewState = getSceneViewState(scene);
      if (viewState) saveCachedCameraView(viewState);
      window.removeEventListener('resize', handleResize);
      scene.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { sceneRef.current?.setControlMode(controlMode); }, [controlMode]);
  useEffect(() => { sceneRef.current?.setBackground(sceneBackground); }, [sceneBackground]);
  useEffect(() => { sceneRef.current?.setCameraFov(FOV_STEPS[perspectiveLevel]); }, [perspectiveLevel]);

  // Structural discs.
  useEffect(() => {
    if (sceneRef.current && holes?.length && structureRows?.length) {
      sceneRef.current.setStructuralDiscs(structureRows, holes, { radius: 5, opacity: 0.75 });
    }
  }, [holes, structureRows]);
  useEffect(() => { sceneRef.current?.setStructuralDiscsVisible(showStructuralDiscs); }, [showStructuralDiscs]);

  // Strip logs.
  useEffect(() => {
    if (!sceneRef.current || !holes?.length) return;
    if (stripLogData?.length) sceneRef.current.setStripLogs(holes, stripLogData);
    else sceneRef.current.clearStripLogs?.();
  }, [holes, stripLogData]);

  // Drillholes + colouring.
  useEffect(() => {
    if (sceneRef.current && holes?.length) {
      const preserveView = renderedHolesRef.current === holes || restoredCameraRef.current;
      sceneRef.current.setDrillholes(holes, {
        selectedAssayVariable: colorByVariable === 'None' ? '' : colorByVariable,
        assayIntervalsByHole: isCategorical ? geologyCategoryIntervalsByHole : selectedAssayIntervalsByHole,
        preserveView,
        isCategoricalVariable: isCategorical,
      });
      renderedHolesRef.current = holes;
      restoredCameraRef.current = false;
    }
  }, [holes, colorByVariable, selectedAssayIntervalsByHole, isCategorical, geologyCategoryIntervalsByHole]);

  const sidebarTarget = typeof document !== 'undefined' ? document.getElementById('three-d-controls-slot') : null;
  const sidebarControls = (
    <div className="three-d-controls">
      <div className="label-caps">3D Scene</div>
      <label className="three-d-control">
        <span>Hole</span>
        <select
          value={selectedHoleId}
          onChange={(e) => setSelectedHoleId(e.target.value)}
          disabled={!allHoleIds.length}
        >
          <option value="">{allHoleIds.length ? 'Pick a hole…' : 'No holes with survey data'}</option>
          {allHoleIds.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="primary-button"
        onClick={() => {
          if (!selectedHoleId) return;
          addHoleToScene(selectedHoleId);
        }}
        disabled={!selectedHoleId || holes.some((h) => h.id === selectedHoleId)}
      >
        {selectedHoleId && holes.some((h) => h.id === selectedHoleId)
          ? 'Already in scene'
          : 'Add to scene'}
      </button>
      {addError && <div className="error-banner small">{addError}</div>}
      {holes.length > 0 && (
        <ul className="three-d-added-list" aria-label="Holes in scene">
          {holes.map((h) => (
            <li key={h.id}>
              <span className="hole-id" title={h.id}>{h.id}</span>
              <button
                type="button"
                className="remove-btn"
                onClick={() => removeHoleFromScene(h.id)}
                aria-label={`Remove ${h.id}`}
                title={`Remove ${h.id}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const dataSourceTarget = typeof document !== 'undefined' ? document.getElementById('data-source-slot') : null;
  const dataSourceInfo = (
    <div className="data-source-text">
      {(collars.length > 0 || holes?.length > 0) && (
        <div>
          {collars.length > 0 && `${collars.length} collars`}
          {holes?.length > 0 && `, ${holes.length} in scene`}
        </div>
      )}
    </div>
  );

  return (
    <div className="drillhole-container">
      <div className="drillhole-header">
        <h1>3D Scene</h1>
        <div className="drillhole-controls">
          <label className="drillhole-color-control">
            Color by
            <select
              className="drillhole-select"
              value={colorByVariable}
              onChange={(e) => setColorByVariable(e.target.value)}
            >
              <option value="None">None</option>
              {assayVariables.map((variable) => (
                <option key={variable} value={variable}>
                  {variable === '__HAS_ASSAY__' ? 'Has Assay Data' : variable}
                </option>
              ))}
              {geologyCategories.length > 0 && (
                <optgroup label="Geology">
                  {geologyCategories.map((v) => (<option key={v} value={v}>{v}</option>))}
                </optgroup>
              )}
            </select>
          </label>
          {structureRows?.length > 0 && (
            <label className="drillhole-color-control">
              <input type="checkbox" checked={showStructuralDiscs} onChange={(e) => setShowStructuralDiscs(e.target.checked)} />
              Structural discs
            </label>
          )}
          {!isCategorical && colorByVariable !== 'None' && colorByVariable !== '__HAS_ASSAY__' && (
            <label className="drillhole-color-control">
              <input type="checkbox" checked={showStripLogs} onChange={(e) => setShowStripLogs(e.target.checked)} />
              Strip logs
            </label>
          )}
          <label className="drillhole-projection-slider">
            Ortho
            <input
              type="range"
              min={0}
              max={FOV_STEPS.length - 1}
              step={1}
              value={perspectiveLevel}
              onChange={(e) => setPerspectiveLevel(Number(e.target.value))}
            />
            Persp
          </label>
          {holes.length > 0 && <span className="drillhole-info">{holes.length} in scene</span>}
          {error && <span className="error-text">{error}</span>}
          {colorByVariable === '__HAS_ASSAY__' && (
            <div className="drillhole-legend">
              <div className="drillhole-legend-title">Legend (Has Assay Data)</div>
              <div className="drillhole-legend-grid">
                <div className="drillhole-legend-item">
                  <span className="drillhole-legend-swatch" style={{ background: '#ff8c42' }} />
                  <span className="drillhole-legend-label">Has assay data</span>
                </div>
                <div className="drillhole-legend-item">
                  <span className="drillhole-legend-swatch" style={{ background: '#9ca3af' }} />
                  <span className="drillhole-legend-label">No assay data</span>
                </div>
              </div>
            </div>
          )}
          {isCategorical && geologyCategoryIntervalsByHole && (() => {
            const cats = [...new Set(
              Object.values(geologyCategoryIntervalsByHole)
                .flatMap((ivs) => ivs.map((iv) => iv.value))
                .filter(Boolean)
            )].sort();
            return cats.length ? (
              <div className="drillhole-legend">
                <div className="drillhole-legend-title">Legend ({colorByVariable})</div>
                <div className="drillhole-legend-grid">
                  {cats.map((cat) => (
                    <div key={cat} className="drillhole-legend-item">
                      <span className="drillhole-legend-swatch" style={{ background: getCategoryHexColor(cat) }} />
                      <span className="drillhole-legend-label">{cat}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null;
          })()}
          {!isCategorical && colorByVariable !== 'None' && colorByVariable !== '__HAS_ASSAY__' && legendScale && (
            <div className="drillhole-legend">
              <div className="drillhole-legend-title">Legend ({colorByVariable})</div>
              <div className="drillhole-legend-grid">
                {legendScale.bins.map((bin, index) => (
                  <div key={`${bin.index}-${index}`} className="drillhole-legend-item">
                    <span className="drillhole-legend-swatch" style={{ background: legendScale.colors[index] }} />
                    <span className="drillhole-legend-label">{bin.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="canvas-container" ref={containerRef}>
        <div className="zoom-slider-overlay">
          <span className="zoom-label">+</span>
          <div className="zoom-slider-track">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              defaultValue={50}
              className="zoom-slider"
              onChange={(e) => {
                const newVal = Number(e.target.value);
                const delta = newVal - zoomSliderPrevRef.current;
                e.target.value = 50;
                zoomSliderPrevRef.current = 50;
                sceneRef.current?.dolly(Math.pow(0.95, delta));
              }}
            />
          </div>
          <span className="zoom-label">−</span>
        </div>
        {status !== 'ready' && (
          <div className="placeholder-message">
            <p>Open a project folder to view drillholes.</p>
          </div>
        )}
        {status === 'ready' && holes.length === 0 && (
          <div className="placeholder-message">
            <p>Add a hole from the sidebar to begin.</p>
          </div>
        )}
        <Baselode3DControls
          controlMode={controlMode}
          onToggleFly={() => setControlMode((m) => (m === 'orbit' ? 'fly' : 'orbit'))}
          onRecenter={() => sceneRef.current?.recenterCameraToOrigin(2000)}
          onLookDown={() => sceneRef.current?.lookDown(3000)}
          onFit={() => sceneRef.current?.focusOnLastBounds(1.2)}
          darkBackground={darkBackground}
          onToggleDarkBackground={(e) => setDarkBackground(e.target.checked)}
        />
        {selectedHole && (
          <div className="selection-popup">
            <div className="selection-header">Drillhole selected</div>
            <div className="selection-body">
              <div><strong>Hole ID:</strong> {selectedHole.holeId}</div>
              <div><strong>Project:</strong> {selectedHole.project || 'N/A'}</div>
            </div>
            <button className="ghost-button small" type="button" onClick={() => setSelectedHole(null)}>Close</button>
          </div>
        )}
      </div>
      {dataSourceTarget && createPortal(dataSourceInfo, dataSourceTarget)}
      {sidebarTarget && createPortal(sidebarControls, sidebarTarget)}
    </div>
  );
}

export default Drillhole;

function buildAssayIntervalsByHole(assayHoles) {
  const byHole = {};
  (assayHoles || []).forEach((hole) => {
    const holeId = hole?.id;
    if (!holeId) return;
    const seen = new Set();
    const intervals = [];
    (hole.points || []).forEach((point) => {
      const from = Number(point?.from ?? point?.samp_from ?? point?.fromdepth ?? point?.from_depth ?? point?.depth_from);
      const to = Number(point?.to ?? point?.samp_to ?? point?.todepth ?? point?.to_depth ?? point?.depth_to);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
      const key = `${from}:${to}`;
      if (seen.has(key)) return;
      seen.add(key);
      intervals.push({ from, to, values: { ...point } });
    });
    if (intervals.length) {
      const sorted = intervals.sort((a, b) => a.from - b.from);
      const aliases = new Set([
        normalizeHoleKey(holeId),
        normalizeHoleKey(sorted[0]?.values?.hole_id),
        normalizeHoleKey(sorted[0]?.values?.holeid),
        normalizeHoleKey(sorted[0]?.values?.anumber),
        normalizeHoleKey(sorted[0]?.values?.id),
      ]);
      aliases.forEach((alias) => { if (alias) byHole[alias] = sorted; });
    }
  });
  return byHole;
}

function mapIntervalsForVariable(intervalsByHole, variable) {
  if (!variable) return null;
  const mapped = {};
  Object.entries(intervalsByHole || {}).forEach(([holeId, intervals]) => {
    const normalizedHoleId = normalizeHoleKey(holeId);
    const entries = (intervals || []).map((interval) => ({
      from: interval.from, to: interval.to,
      value: Number(interval?.values?.[variable]),
    })).filter((entry) => Number.isFinite(entry.value));
    if (entries.length) mapped[normalizedHoleId] = entries;
  });
  return mapped;
}

function buildEqualRangeColorScale(values = [], colors = ASSAY_COLOR_PALETTE_10) {
  let min = Infinity, max = -Infinity, count = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    count += 1;
  }
  if (!count) return { min: null, max: null, step: null, bins: [], colors };
  const binCount = colors.length;
  if (max === min) {
    return { min, max, step: 0, bins: colors.map((_, i) => ({ index: i, min, max, label: `${min}` })), colors };
  }
  const step = (max - min) / binCount;
  const bins = colors.map((_, index) => {
    const lower = min + step * index;
    const upper = index === binCount - 1 ? max : min + step * (index + 1);
    return { index, min: lower, max: upper, label: `${lower.toFixed(3)} - ${upper.toFixed(3)}` };
  });
  return { min, max, step, bins, colors };
}

function normalizeHoleKey(value) {
  return `${value ?? ''}`.trim().toLowerCase();
}

function buildCategoryIntervalsByHole(holes, variable) {
  const byHole = {};
  (holes || []).forEach((hole) => {
    const holeId = hole?.id || hole?.holeId;
    if (!holeId) return;
    const seen = new Set();
    const intervals = [];
    (hole.points || []).forEach((point) => {
      const from = Number(point?.from);
      const to = Number(point?.to);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
      const key = `${from}:${to}`;
      if (seen.has(key)) return;
      seen.add(key);
      const value = point[variable];
      if (value == null || String(value).trim() === '') return;
      intervals.push({ from, to, value: String(value).trim() });
    });
    if (intervals.length) byHole[normalizeHoleKey(holeId)] = intervals.sort((a, b) => a.from - b.from);
  });
  return byHole;
}

function commodityColorForVariable(variable) {
  if (!variable) return '#8b1e3f';
  const tokens = variable.split(/[_\-/\s]+/);
  for (const token of tokens) {
    if (Object.prototype.hasOwnProperty.call(COMMODITY_COLOURS, token)) return COMMODITY_COLOURS[token];
    const low = token.toLowerCase();
    for (const [key, colour] of Object.entries(COMMODITY_COLOURS)) {
      if (key.toLowerCase() === low) return colour;
    }
  }
  return '#8b1e3f';
}

function loadCachedCameraView() {
  try {
    const raw = localStorage.getItem(CAMERA_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) { return null; }
}

function saveCachedCameraView(viewState) {
  try { localStorage.setItem(CAMERA_CACHE_KEY, JSON.stringify(viewState)); } catch (e) { /* ignore */ }
}

function getSceneViewState(scene) {
  if (!scene) return null;
  if (typeof scene.getViewState === 'function') return scene.getViewState();
  const camera = scene.camera;
  const target = scene.controls?.target;
  if (!camera || !target) return null;
  return {
    camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: target.x, y: target.y, z: target.z },
    up: { x: camera.up.x, y: camera.up.y, z: camera.up.z },
  };
}

function setSceneViewState(scene, viewState) {
  if (!scene || !viewState) return false;
  if (typeof scene.setViewState === 'function') return scene.setViewState(viewState);
  const camera = scene.camera;
  const controls = scene.controls;
  if (!camera || !controls) return false;
  const cam = viewState.camera || {}, tgt = viewState.target || {}, up = viewState.up || {};
  const values = [cam.x, cam.y, cam.z, tgt.x, tgt.y, tgt.z, up.x, up.y, up.z];
  if (!values.every(Number.isFinite)) return false;
  camera.position.set(cam.x, cam.y, cam.z);
  controls.target.set(tgt.x, tgt.y, tgt.z);
  camera.up.set(up.x, up.y, up.z);
  camera.lookAt(tgt.x, tgt.y, tgt.z);
  controls.update();
  return true;
}
