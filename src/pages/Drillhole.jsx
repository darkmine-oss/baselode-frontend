/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
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
  const objFileInputRef = useRef(null);
  const objMeshGroupsRef = useRef(new Map());
  const restoredCameraRef = useRef(false);
  const zoomSliderPrevRef = useRef(50);

  const { collars, assayState, structureRows, geologyHoles, rawCsv, status } = useProjectData();

  // Scene contains only holes the user has explicitly added via the sidebar.
  const [holes, setHoles] = useState([]);
  const [selectedHoleId, setSelectedHoleId] = useState('');
  const [addError, setAddError] = useState('');
  const [objMeshes, setObjMeshes] = useState([]);
  const [objError, setObjError] = useState('');

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
    const valueRange = finiteValueRange(allValues);
    const valueMin = valueRange?.min ?? null;
    const valueMax = valueRange?.max ?? null;
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

  // Transform that georeferences loaded OBJ meshes (which are exported in the
  // project's projected CRS, e.g. UTM/MGA easting-northing) into the scene's
  // local-meters frame so they overlay the drillholes. Fitted directly from
  // the collars, which carry both lat/lng and easting/northing — no CRS/zone
  // metadata or proj dependency needed. Null until enough control points exist.
  const utmToLocal = useMemo(() => fitUtmToLocalTransform(collars, project), [collars, project]);

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

  const removeObjMeshFromScene = useCallback((meshId) => {
    const group = objMeshGroupsRef.current.get(meshId);
    if (group && sceneRef.current?.scene) {
      sceneRef.current.scene.remove(group);
      disposeObject3D(group);
    }
    objMeshGroupsRef.current.delete(meshId);
    setObjMeshes((prev) => prev.filter((mesh) => mesh.id !== meshId));
  }, []);

  const loadObjFile = useCallback(async (file) => {
    if (!file || !sceneRef.current?.scene) return;
    setObjError('');
    try {
      const text = await file.text();
      const group = new OBJLoader().parse(text);
      // Georeference into the local frame when the mesh's coordinates land
      // inside the project's grid extent — that's how we tell a CRS-projected
      // export apart from an OBJ that is already in local meters (which we
      // must leave untouched, or the transform would fling it ~6,000 km away).
      const georeferenced = applyGeoreferenceIfInRange(group, utmToLocal);
      const id = `${file.name}:${file.lastModified || Date.now()}:${Math.random().toString(36).slice(2)}`;
      const stats = prepareObjMeshGroup(group, file.name);
      if (!stats.meshCount) throw new Error('OBJ file did not contain any mesh geometry.');
      sceneRef.current.scene.add(group);
      objMeshGroupsRef.current.set(id, group);
      reconcileSceneBounds(sceneRef.current, holes, objMeshGroupsRef.current);
      sceneRef.current.focusOnLastBounds?.(1.2);
      setObjMeshes((prev) => [...prev, { id, name: file.name, georeferenced, ...stats }]);
    } catch (e) {
      setObjError(e?.message || String(e));
    } finally {
      if (objFileInputRef.current) objFileInputRef.current.value = '';
    }
  }, [holes, utmToLocal]);

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
    enforceZUpOrbit(scene);
    sceneRef.current = scene;

    const handleResize = () => scene.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      if (viewSaveInterval) window.clearInterval(viewSaveInterval);
      const viewState = getSceneViewState(scene);
      if (viewState) saveCachedCameraView(viewState);
      window.removeEventListener('resize', handleResize);
      objMeshGroupsRef.current.forEach((group) => disposeObject3D(group));
      objMeshGroupsRef.current.clear();
      scene.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    sceneRef.current?.setControlMode(controlMode);
    if (controlMode === 'orbit') enforceZUpOrbit(sceneRef.current);
  }, [controlMode]);
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
    if (sceneRef.current) {
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

  useEffect(() => {
    if (!sceneRef.current) return;
    reconcileSceneBounds(sceneRef.current, holes, objMeshGroupsRef.current);
  }, [holes, objMeshes]);

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
      <div className="three-d-divider" />
      <button
        type="button"
        className="secondary-button"
        onClick={() => objFileInputRef.current?.click()}
      >
        Load OBJ mesh
      </button>
      <input
        ref={objFileInputRef}
        type="file"
        accept=".obj,text/plain"
        className="visually-hidden"
        onChange={(e) => loadObjFile(e.target.files?.[0])}
      />
      {objError && <div className="error-banner small">{objError}</div>}
      {objMeshes.length > 0 && (
        <ul className="three-d-added-list" aria-label="OBJ meshes in scene">
          {objMeshes.map((mesh) => (
            <li key={mesh.id}>
              <span
                className="hole-id"
                title={`${mesh.name} (${mesh.vertexCount} vertices) — ${mesh.georeferenced ? 'georeferenced to project collars' : 'loaded in raw mesh coordinates'}`}
              >
                {mesh.name}
              </span>
              {!mesh.georeferenced && (
                <span className="obj-mesh-flag" title="Mesh coordinates were not aligned to the project — load collars in the same CRS to overlay drillholes.">
                  raw
                </span>
              )}
              <button
                type="button"
                className="remove-btn"
                onClick={() => removeObjMeshFromScene(mesh.id)}
                aria-label={`Remove ${mesh.name}`}
                title={`Remove ${mesh.name}`}
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
      {(collars.length > 0 || holes?.length > 0 || objMeshes.length > 0) && (
        <div>
          {collars.length > 0 && `${collars.length} collars`}
          {holes?.length > 0 && `, ${holes.length} in scene`}
          {objMeshes.length > 0 && `, ${objMeshes.length} OBJ mesh${objMeshes.length === 1 ? '' : 'es'}`}
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
        {status === 'ready' && holes.length === 0 && objMeshes.length === 0 && (
          <div className="placeholder-message">
            <p>Add a hole from the sidebar to begin.</p>
          </div>
        )}
        <Baselode3DControls
          controlMode={controlMode}
          onToggleFly={() => setControlMode((m) => (m === 'orbit' ? 'fly' : 'orbit'))}
          onRecenter={() => recenterCameraToOriginZUp(sceneRef.current, 2000)}
          onLookDown={() => lookDownZUp(sceneRef.current, 3000)}
          onFit={() => focusOnLastBoundsZUp(sceneRef.current, 1.2)}
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

function finiteValueRange(values) {
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (const value of values || []) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    count += 1;
  }
  return count ? { min, max } : null;
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
  if (typeof scene.setViewState === 'function') {
    const applied = scene.setViewState(viewState);
    if (applied) enforceZUpOrbit(scene);
    return applied;
  }
  const camera = scene.camera;
  const controls = scene.controls;
  if (!camera || !controls) return false;
  const cam = viewState.camera || {}, tgt = viewState.target || {};
  const values = [cam.x, cam.y, cam.z, tgt.x, tgt.y, tgt.z];
  if (!values.every(Number.isFinite)) return false;
  camera.position.set(cam.x, cam.y, cam.z);
  controls.target.set(tgt.x, tgt.y, tgt.z);
  camera.lookAt(tgt.x, tgt.y, tgt.z);
  enforceZUpOrbit(scene);
  return true;
}

function recenterCameraToOriginZUp(scene, distance = 1000) {
  if (!scene?.camera || !scene?.controls) return;
  scene.controls.target.set(0, 0, 0);
  scene.camera.position.set(distance, distance, distance);
  enforceZUpOrbit(scene);
}

function focusOnLastBoundsZUp(scene, padding = 1.2) {
  if (!scene?.lastBounds || !scene?.camera || !scene?.controls) return;
  scene.focusOnLastBounds?.(padding);
  enforceZUpOrbit(scene);
}

function lookDownZUp(scene, distance = 2000) {
  if (!scene?.camera || !scene?.controls) return;
  const target = scene.lastBounds ? centerFromBounds(scene.lastBounds) : new THREE.Vector3(0, 0, 0);
  const safeDistance = Number.isFinite(distance) && distance > 0 ? distance : 2000;
  const nudge = Math.max(safeDistance * 0.001, 1);
  scene.controls.target.copy(target);
  scene.camera.position.set(target.x + nudge, target.y, target.z + safeDistance);
  enforceZUpOrbit(scene);
}

function enforceZUpOrbit(scene) {
  const camera = scene?.camera;
  const controls = scene?.controls;
  if (!camera || !controls) return false;
  const target = controls.target || new THREE.Vector3(0, 0, 0);
  const offset = camera.position.clone().sub(target);
  const distance = offset.length();
  if (distance > 0) {
    const zAlignment = Math.abs(offset.normalize().dot(new THREE.Vector3(0, 0, 1)));
    if (zAlignment > 0.999) {
      camera.position.x += Math.max(distance * 0.001, 1);
    }
  }
  camera.up.set(0, 0, 1);
  camera.lookAt(target);
  controls.update();
  return true;
}

function centerFromBounds(bounds) {
  return new THREE.Vector3(
    (Number(bounds.minX) + Number(bounds.maxX)) / 2,
    (Number(bounds.minY) + Number(bounds.maxY)) / 2,
    (Number(bounds.minZ) + Number(bounds.maxZ)) / 2
  );
}

// Least-squares 2D similarity (rotation + uniform scale + translation) mapping
// projected grid coordinates (easting, northing) into the scene's local frame,
// fitted from collars that carry both lat/lng and easting/northing. Over a
// project's few-km extent the UTM grid and the local tangent plane differ only
// by grid convergence (a small rotation) and the point scale factor (a small
// uniform scale) — both captured exactly by a similarity, so residuals are
// centimetre-level. Returns `{ apply, bbox }` or null when <2 control points.
function fitUtmToLocalTransform(collars, project) {
  if (!project) return null;
  const pts = [];
  let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity;
  (collars || []).forEach((c) => {
    const e = Number(c?.easting);
    const n = Number(c?.northing);
    if (!Number.isFinite(e) || !Number.isFinite(n)) return;
    const local = project(c.lat, c.lng);
    if (!Number.isFinite(local?.x) || !Number.isFinite(local?.y)) return;
    pts.push({ e, n, x: local.x, y: local.y });
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
    if (n < minN) minN = n;
    if (n > maxN) maxN = n;
  });
  if (pts.length < 2) return null;

  const count = pts.length;
  let me = 0, mn = 0, mx = 0, my = 0;
  pts.forEach((p) => { me += p.e; mn += p.n; mx += p.x; my += p.y; });
  me /= count; mn /= count; mx /= count; my /= count;

  // x = a*e - b*n + tx, y = b*e + a*n + ty (a = s·cosθ, b = s·sinθ).
  let sden = 0, sa = 0, sb = 0;
  pts.forEach((p) => {
    const e = p.e - me, n = p.n - mn, x = p.x - mx, y = p.y - my;
    sden += e * e + n * n;
    sa += e * x + n * y;
    sb += e * y - n * x;
  });
  if (sden === 0) return null;
  const a = sa / sden;
  const b = sb / sden;
  const tx = mx - (a * me - b * mn);
  const ty = my - (b * me + a * mn);

  return {
    apply: (e, n) => ({ x: a * e - b * n + tx, y: b * e + a * n + ty }),
    bbox: { minE, minN, maxE, maxN },
  };
}

// Reproject an OBJ group in place from projected grid coords to the local frame,
// but only when its horizontal centre falls within the project's grid extent
// (generous margin). Leaves the X/Y untouched — and Z always — otherwise, so an
// OBJ already authored in local meters passes through unchanged. Returns whether
// the transform was applied. Vertex normals are (re)computed later in
// prepareObjMeshGroup, so we only need to move positions here.
function applyGeoreferenceIfInRange(group, transform) {
  if (!transform) return false;
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return false;
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const margin = 50_000; // ~50 km tolerance around the collars' grid extent
  const { minE, minN, maxE, maxN } = transform.bbox;
  if (cx < minE - margin || cx > maxE + margin || cy < minN - margin || cy > maxN + margin) {
    return false;
  }
  group.traverse((child) => {
    const pos = child.isMesh ? child.geometry?.attributes?.position : null;
    if (!pos) return;
    for (let i = 0; i < pos.count; i += 1) {
      const { x, y } = transform.apply(pos.getX(i), pos.getY(i));
      pos.setXYZ(i, x, y, pos.getZ(i));
    }
    pos.needsUpdate = true;
  });
  return true;
}

function prepareObjMeshGroup(group, name) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xf2c94c,
    roughness: 0.62,
    metalness: 0.02,
    transparent: true,
    opacity: 0.52,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  let meshCount = 0;
  let vertexCount = 0;
  group.name = name || 'OBJ mesh';
  group.userData = { type: 'obj-mesh', name: group.name };
  group.traverse((child) => {
    if (!child.isMesh) return;
    meshCount += 1;
    const geometry = child.geometry;
    if (geometry?.attributes?.position) vertexCount += geometry.attributes.position.count;
    geometry?.computeVertexNormals?.();
    disposeMaterial(child.material);
    child.material = material.clone();
    child.castShadow = false;
    child.receiveShadow = false;
    child.userData = { type: 'obj-mesh', name: group.name };
  });
  material.dispose();
  const box = new THREE.Box3().setFromObject(group);
  const bounds = box.isEmpty() ? null : boundsFromBox(box);
  return { meshCount, vertexCount, bounds };
}

function reconcileSceneBounds(scene, holes, objGroups) {
  const box = new THREE.Box3();
  let hasBounds = false;
  (holes || []).forEach((hole) => {
    (hole.points || []).forEach((point) => {
      const x = Number(point?.x), y = Number(point?.y), z = Number(point?.z);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
      box.expandByPoint(new THREE.Vector3(x, y, z));
      hasBounds = true;
    });
  });
  objGroups.forEach((group) => {
    const objBox = new THREE.Box3().setFromObject(group);
    if (objBox.isEmpty()) return;
    box.union(objBox);
    hasBounds = true;
  });
  if (hasBounds) scene.lastBounds = boundsFromBox(box);
}

function boundsFromBox(box) {
  return {
    minX: box.min.x,
    maxX: box.max.x,
    minY: box.min.y,
    maxY: box.max.y,
    minZ: box.min.z,
    maxZ: box.max.z,
  };
}

function disposeObject3D(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry?.dispose?.();
    disposeMaterial(child.material);
  });
}

function disposeMaterial(material) {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry?.dispose?.());
    return;
  }
  material?.dispose?.();
}
