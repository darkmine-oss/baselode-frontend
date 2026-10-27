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
  parseDrillholesFromRows,
  parseSurveyCSV,
  parseSurveyFromRows,
  minimumCurvatureDesurvey,
  classifyColumns,
  getCategoryHexColor,
  COMMODITY_COLOURS,
} from 'baselode';
import 'baselode/style.css';
import './Drillhole.css';
import { useProjectData } from '../context/ProjectDataContext.jsx';
import { isLocalGridProject, localCollarXY } from '../lib/projectCoordinates.js';
import { appendUniqueHoles, collectSceneHoles, loadObjFilesSequentially } from '../lib/sceneImports.js';
import { makeLocalProjector } from '../lib/localProjection.js';
import { buildCategoricalColorMap, colorForCategory } from '../lib/categoricalColors.js';

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
// v2: precomputed-desurvey holes are now reprojected into the local frame
// (previously left in raw UTM), so cameras cached against the old coordinates
// would aim at empty space. Bumping the key discards those stale views.
const CAMERA_CACHE_KEY = 'baselode-viewer-camera-v2';
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
  const hasFramedContentRef = useRef(false);
  const objFileInputRef = useRef(null);
  const objMeshGroupsRef = useRef(new Map());
  const projectGenerationRef = useRef(0);
  const holesRef = useRef([]);
  const restoredCameraRef = useRef(false);
  const zoomSliderPrevRef = useRef(50);

  const { collars, assayState, structureRows, geologyHoles, rawCsv, status } = useProjectData();

  const localGrid = useMemo(() => isLocalGridProject(collars), [collars]);

  // Scene contains only holes the user has explicitly added via the sidebar.
  const [holes, setHoles] = useState([]);
  const [selectedHoleId, setSelectedHoleId] = useState('');
  const [selectedCollarHoleId, setSelectedCollarHoleId] = useState('');
  const [selectedNoSurveyHoleId, setSelectedNoSurveyHoleId] = useState('');
  const [addError, setAddError] = useState('');
  const [objMeshes, setObjMeshes] = useState([]);
  const [objError, setObjError] = useState('');
  const [objLoading, setObjLoading] = useState('');
  const [selectedMeshId, setSelectedMeshId] = useState(null);
  const [holePageIndex, setHolePageIndex] = useState(0);
  holesRef.current = holes;
  const holeIdsInScene = useMemo(() => new Set(holes.map(hole => hole.id)), [holes]);
  const holePage = Math.min(holePageIndex, Math.max(0, Math.ceil(holes.length / 100) - 1));
  const selectedMesh = objMeshes.find(mesh => mesh.id === selectedMeshId) || null;

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
  const categoricalColorMap = useMemo(
    () => buildCategoricalColorMap(geologyHoles, rawCsv?.colors, colorByVariable),
    [geologyHoles, rawCsv?.colors, colorByVariable],
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

  // Parse survey rows once per project and retain the resulting traces for
  // individual and bulk additions. baselode's
  // parseSurveyCSV is async, so we land it in state via useEffect.
  const [surveyRows, setSurveyRows] = useState(null);
  const [parsedSurveySource, setParsedSurveySource] = useState(null);
  const [parsedPrecomputedSource, setParsedPrecomputedSource] = useState(null);
  const geometryReady = (!rawCsv?.survey?.length || parsedSurveySource === rawCsv.survey)
    && (!rawCsv?.precomputed?.length || parsedPrecomputedSource === rawCsv.precomputed);
  useEffect(() => {
    if (!rawCsv?.survey?.length) {
      setSurveyRows(null);
      return undefined;
    }
    let cancelled = false;
    Promise.resolve()
      .then(() => (Array.isArray(rawCsv.survey)
        ? parseSurveyFromRows(rawCsv.survey)
        : parseSurveyCSV(rawCsv.survey)))
      .then((rows) => { if (!cancelled) setSurveyRows(rows?.length ? rows : null); })
      .catch((e) => {
        console.warn('Survey parse failed:', e);
        if (!cancelled) setSurveyRows(null);
      })
      .finally(() => { if (!cancelled) setParsedSurveySource(rawCsv.survey); });
    return () => { cancelled = true; };
  }, [rawCsv?.survey]);

  // Precomputed desurveyed holes indexed by id (when the project supplies
  // a `precomputed_desurveyed` file). Adds prefer this over re-running the
  // desurvey when an entry exists. parseDrillholesCSV is also async.
  const [precomputedByHole, setPrecomputedByHole] = useState({});
  useEffect(() => {
    if (!rawCsv?.precomputed?.length) {
      setPrecomputedByHole({});
      return undefined;
    }
    let cancelled = false;
    Promise.resolve()
      .then(() => (Array.isArray(rawCsv.precomputed)
        ? parseDrillholesFromRows(rawCsv.precomputed)
        : parseDrillholesCSV(rawCsv.precomputed)))
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
      })
      .finally(() => { if (!cancelled) setParsedPrecomputedSource(rawCsv.precomputed); });
    return () => { cancelled = true; };
  }, [rawCsv?.precomputed]);

  // Fixed local-meters frame, centred on the collar centroid. We compute
  // this from ALL collars (not just the added ones) so the origin stays
  // stable as the user adds/removes holes — the scene doesn't shift under
  // the camera.
  const project = useMemo(() => {
    if (!collars.length) return null;
    if (localGrid) return () => null;
    const refLat = collars.reduce((s, c) => s + c.lat, 0) / collars.length;
    const refLng = collars.reduce((s, c) => s + c.lng, 0) / collars.length;
    return makeLocalProjector(refLat, refLng);
  }, [collars, localGrid]);

  // Transform that georeferences loaded OBJ meshes (which are exported in the
  // project's projected CRS, e.g. UTM/MGA easting-northing) into the scene's
  // local-meters frame so they overlay the drillholes. Fitted directly from
  // the collars, which carry both lat/lng and easting/northing — no CRS/zone
  // metadata or proj dependency needed. Null until enough control points exist.
  const utmToLocal = useMemo(() => localGrid ? null : fitUtmToLocalTransform(collars, project), [collars, project, localGrid]);

  // Single lat/lng -> scene-metres entry point. The fitted UTM transform is
  // preferred when the collars supply enough control points (it is the same
  // mapping precomputed traces and OBJ meshes go through, so everything lands
  // in one frame); the tangent-plane projector is the fallback.
  const projectLatLngToScene = useCallback((lat, lng, collar) => (
    localGrid ? localCollarXY(collar) : (utmToLocal?.projectLatLng(lat, lng) || project?.(lat, lng) || null)
  ), [utmToLocal, project, localGrid]);

  // Retain the traces used for classification so a bulk add desurveys once.
  const surveyedByHole = useMemo(() => {
    if (!surveyRows?.length || !collars.length) return new Map();
    try {
      return new Map(desurveyHolesInSceneFrame(collars, surveyRows, projectLatLngToScene)
        .map(hole => [hole.id, hole]));
    } catch { return new Map(); }
  }, [collars, surveyRows, projectLatLngToScene]);
  const collarsById = useMemo(() => new Map(collars.map(collar => [collar.holeId, collar])), [collars]);
  const holeBuckets = useMemo(() => {
    const full = [];
    const collar = [];
    const noSurvey = [];
    const seen = new Set();
    for (const c of collars) {
      const id = c.holeId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const preN = precomputedByHole[id]?.points?.length || 0;
      // Classification follows the same precomputed-first rule as adding.
      const geomN = preN || surveyedByHole.get(id)?.points?.length || 0;
      if (geomN >= 2) full.push(id);
      else if (preN >= 1 || Number.isFinite(c.elevation)) collar.push(id);
      else noSurvey.push(id);
    }
    full.sort(); collar.sort(); noSurvey.sort();
    return { full, collar, noSurvey };
  }, [collars, surveyedByHole, precomputedByHole]);

  // Reset scene-holes whenever the project changes underneath us. Without
  // this, leftover holes from a previous project would refuse to clear.
  // Loaded OBJ meshes go too: they were georeferenced against the previous
  // project's collars, so keeping them would leave stale geometry in the
  // scene and in the bounds.
  useEffect(() => {
    projectGenerationRef.current += 1;
    setHoles([]);
    setHolePageIndex(0);
    setSelectedMeshId(null);
    setSelectedHole(null);
    setObjLoading('');
    setAddError('');
    setError('');
    setSelectedHoleId('');
    setSelectedCollarHoleId('');
    setSelectedNoSurveyHoleId('');
    if (objMeshGroupsRef.current.size) {
      objMeshGroupsRef.current.forEach((group, id) => {
        sceneRef.current?.unregisterMeshObject(id);
        sceneRef.current?.scene?.remove(group);
        disposeObject3D(group);
      });
      objMeshGroupsRef.current.clear();
    }
    setObjMeshes([]);
    setObjError('');
  }, [collars, rawCsv?.survey, rawCsv?.precomputed]);

  const resolveSceneHole = useCallback(holeId => {
    const pre = precomputedByHole[holeId];
    if (pre) return toLocalFrameHole(pre, utmToLocal);
    const surveyed = surveyedByHole.get(holeId);
    if (surveyed?.points?.length) return surveyed;
    const collar = collarsById.get(holeId);
    if (!collar || !Number.isFinite(collar.elevation)) throw new Error('No collar elevation or trace');
    const xy = projectLatLngToScene(collar.lat, collar.lng, collar);
    if (!Number.isFinite(xy?.x) || !Number.isFinite(xy?.y)) throw new Error('No horizontal coordinates');
    return { id: holeId, project: collar.project, points: [{ ...xy, z: collar.elevation, md: 0 }] };
  }, [precomputedByHole, surveyedByHole, collarsById, utmToLocal, projectLatLngToScene]);

  const addHolesToScene = useCallback(ids => {
    const { holes: additions, errors } = collectSceneHoles(ids.filter(id => !holeIdsInScene.has(id)), resolveSceneHole);
    setHoles(previous => appendUniqueHoles(previous, additions));
    setAddError(errors.join('; '));
  }, [holeIdsInScene, resolveSceneHole]);
  const addHoleToScene = useCallback(id => addHolesToScene([id]), [addHolesToScene]);

  const removeHoleFromScene = useCallback(holeId => {
    setHoles(previous => previous.filter(hole => hole.id !== holeId));
  }, []);

  const selectObjMesh = useCallback(id => {
    sceneRef.current?.selectMeshObject(id);
    setSelectedMeshId(id);
    setSelectedHole(null);
  }, []);
  const changeMeshColor = useCallback((id, color) => {
    sceneRef.current?.setMeshObjectColor(id, color);
    setObjMeshes(previous => previous.map(mesh => mesh.id === id ? { ...mesh, color } : mesh));
  }, []);
  const removeObjMeshFromScene = useCallback(id => {
    const group = objMeshGroupsRef.current.get(id);
    sceneRef.current?.unregisterMeshObject(id);
    if (group) { group.removeFromParent(); disposeObject3D(group); }
    objMeshGroupsRef.current.delete(id);
    setObjMeshes(previous => previous.filter(mesh => mesh.id !== id));
    setSelectedMeshId(previous => previous === id ? null : previous);
  }, []);

  const loadObjFiles = useCallback(async fileList => {
    const files = Array.from(fileList || []);
    const scene = sceneRef.current;
    if (!files.length || !scene?.scene || objLoading) return;
    if (objFileInputRef.current) objFileInputRef.current.value = '';
    const generation = projectGenerationRef.current;
    const isCurrent = () => projectGenerationRef.current === generation && sceneRef.current === scene;
    setObjError('');
    const result = await loadObjFilesSequentially(files, {
      isCurrent,
      onProgress: (index, total, name) => setObjLoading(`Loading ${index}/${total}: ${name}`),
      load: async file => {
        const text = await file.text();
        if (!isCurrent()) return null;
        const group = new OBJLoader().parse(text);
        const id = crypto.randomUUID();
        try {
          const georeferenced = applyGeoreferenceIfInRange(group, utmToLocal);
          const stats = prepareObjMeshGroup(group, file.name);
          if (!stats.meshCount) throw new Error('No mesh geometry');
          scene.registerMeshObject(id, group, { name: file.name });
          scene.scene.add(group);
          objMeshGroupsRef.current.set(id, group);
          return { id, name: file.name, color: '#f2c94c', georeferenced, ...stats };
        } catch (error) {
          scene.unregisterMeshObject(id);
          group.removeFromParent();
          disposeObject3D(group);
          throw error;
        }
      },
    });
    if (result.cancelled || !isCurrent()) return;
    setObjMeshes(previous => [...previous, ...result.entries]);
    setObjError(result.errors.join('; '));
    setObjLoading('');
    if (result.entries.length) {
      reconcileSceneBounds(scene, holesRef.current, objMeshGroupsRef.current);
      if (!holesRef.current.length) scene.focusOnLastBounds?.(1.2);
      hasFramedContentRef.current = true;
      selectObjMesh(result.entries[0].id);
    }
  }, [objLoading, utmToLocal, selectObjMesh]);

  // Initialise scene once.
  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new Baselode3DScene();
    let viewSaveInterval = null;
    scene.init(containerRef.current);
    scene.setDrillholeClickHandler(meta => { setSelectedHole(meta); setSelectedMeshId(null); });
    scene.setMeshClickHandler(meta => { setSelectedMeshId(meta.id); setSelectedHole(null); });
    const clearSelection = () => { setSelectedHole(null); setSelectedMeshId(null); };
    scene.setEmptyClickHandler(clearSelection);
    scene.setEscapeHandler(clearSelection);
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
      projectGenerationRef.current += 1;
      scene.clearMeshObjects();
      objMeshGroupsRef.current.forEach(group => { group.removeFromParent(); disposeObject3D(group); });
      objMeshGroupsRef.current.clear();
      scene.dispose();
      sceneRef.current = null;
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
    } else sceneRef.current?.setStructuralDiscs([], []);
  }, [holes, structureRows]);
  useEffect(() => { sceneRef.current?.setStructuralDiscsVisible(showStructuralDiscs); }, [showStructuralDiscs]);

  // Strip logs.
  useEffect(() => {
    if (!sceneRef.current) return;
    if (stripLogData?.length) sceneRef.current.setStripLogs(holes, stripLogData);
    else sceneRef.current.clearStripLogs?.();
  }, [holes, stripLogData]);

  // Drillholes + colouring.
  useEffect(() => {
    if (sceneRef.current) {
      // The local frame is centred on the collar centroid, which can sit a long
      // way (kilometres) from whichever holes the user actually adds. So the
      // first time content appears, always frame it — otherwise the orbit pivot
      // (controls.target) stays near the world origin and rotation swings the
      // content around in a wide arc. After that initial fit, honour the cached
      // / preserved view so colour-by toggles don't yank the camera.
      const firstContent = holes.length > 0 && !hasFramedContentRef.current;
      const preserveView = !firstContent
        && (renderedHolesRef.current === holes || restoredCameraRef.current);
      sceneRef.current.setDrillholes(holes, {
        selectedAssayVariable: colorByVariable === 'None' ? '' : colorByVariable,
        assayIntervalsByHole: isCategorical ? geologyCategoryIntervalsByHole : selectedAssayIntervalsByHole,
        preserveView,
        isCategoricalVariable: isCategorical,
        categoryColorMap: categoricalColorMap,
      });
      if (firstContent) enforceZUpOrbit(sceneRef.current);
      if (holes.length > 0) hasFramedContentRef.current = true;
      renderedHolesRef.current = holes;
      restoredCameraRef.current = false;
      // setDrillholes overwrites scene.lastBounds with hole-only bounds, so
      // fold any loaded OBJ meshes back in immediately — the effect below
      // doesn't re-run for colour/interval changes.
      reconcileSceneBounds(sceneRef.current, holes, objMeshGroupsRef.current);
    }
  }, [holes, colorByVariable, selectedAssayIntervalsByHole, isCategorical, geologyCategoryIntervalsByHole, categoricalColorMap]);

  useEffect(() => {
    if (!sceneRef.current) return;
    reconcileSceneBounds(sceneRef.current, holes, objMeshGroupsRef.current);
  }, [holes, objMeshes]);

  const sidebarTarget = typeof document !== 'undefined' ? document.getElementById('three-d-controls-slot') : null;
  const sidebarControls = (
    <div className="three-d-controls">
      <div className="label-caps">3D Scene</div>

      <section className="three-d-picker-section" aria-labelledby="three-d-picker-heading">
        <div className="three-d-section-heading" id="three-d-picker-heading">Select a hole to add</div>
        <div className="three-d-section-help">Choose a hole below, then add it to the 3D scene.</div>

        {/* Holes with a real desurveyed drill string (>= 2 points). */}
        <label className="three-d-control">
          <span>Hole (3D string)</span>
          <select
            value={selectedHoleId}
            onChange={(e) => setSelectedHoleId(e.target.value)}
            disabled={!holeBuckets.full.length}
          >
            <option value="">{holeBuckets.full.length ? 'Pick a hole…' : 'No holes with a 3D string'}</option>
            {holeBuckets.full.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary-button" onClick={() => addHolesToScene(holeBuckets.full)}
          disabled={!geometryReady || !holeBuckets.full.some(id => !holeIdsInScene.has(id))}>
          Add all holes
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            if (!selectedHoleId) return;
            addHoleToScene(selectedHoleId);
          }}
          disabled={!geometryReady || !selectedHoleId || holeIdsInScene.has(selectedHoleId)}
        >
          {selectedHoleId && holes.some((h) => h.id === selectedHoleId)
            ? 'Already in scene'
            : 'Add to scene'}
        </button>

        {/* No drill string, but a precomputed point or collar elevation provides
            one accurate point. */}
        {holeBuckets.collar.length > 0 && (
          <>
            <label className="three-d-control">
              <span>Hole (point only)</span>
              <select
                value={selectedCollarHoleId}
                onChange={(e) => setSelectedCollarHoleId(e.target.value)}
              >
                <option value="">Pick a hole…</option>
                {holeBuckets.collar.map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </label>
            <button type="button" className="secondary-button" onClick={() => addHolesToScene(holeBuckets.collar)}
              disabled={!geometryReady || !holeBuckets.collar.some(id => !holeIdsInScene.has(id))}>
              Add all holes
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                if (!selectedCollarHoleId) return;
                addHoleToScene(selectedCollarHoleId);
              }}
              disabled={!geometryReady || !selectedCollarHoleId || holeIdsInScene.has(selectedCollarHoleId)}
            >
              {selectedCollarHoleId && holes.some((h) => h.id === selectedCollarHoleId)
                ? 'Already in scene'
                : 'Add point to scene'}
            </button>
          </>
        )}

        {/* No trace and no elevation — can't be placed in 3D. Listed for
            reference only; not addable. */}
        {holeBuckets.noSurvey.length > 0 && (
          <label className="three-d-control">
            <span>Hole (no survey)</span>
            <select
              value={selectedNoSurveyHoleId}
              onChange={(e) => setSelectedNoSurveyHoleId(e.target.value)}
              title="These holes have no desurveyed trace and no collar elevation, so they can't be placed in 3D."
            >
              <option value="">{`${holeBuckets.noSurvey.length} hole${holeBuckets.noSurvey.length === 1 ? '' : 's'} — no 3D geometry`}</option>
              {holeBuckets.noSurvey.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </label>
        )}
      </section>

      {addError && <div className="error-banner small">{addError}</div>}
      {holes.length > 0 && (
        <section className="three-d-scene-section" aria-labelledby="three-d-scene-heading">
          <div className="three-d-section-heading" id="three-d-scene-heading">
            Holes in scene <span className="three-d-scene-count">{holes.length}</span>
          </div>
          <div className="three-d-section-help">Visible in the 3D view. Remove a hole with ×.</div>
          <ul className="three-d-added-list" aria-label="Holes in scene">
            {holes.slice(holePage * 100, (holePage + 1) * 100).map((h) => (
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
          {holes.length > 100 && <div className="three-d-list-pages">
            <button type="button" disabled={holePage === 0} onClick={() => setHolePageIndex(holePage - 1)}>Previous</button>
            <span>{holePage * 100 + 1}–{Math.min((holePage + 1) * 100, holes.length)} of {holes.length}</span>
            <button type="button" disabled={(holePage + 1) * 100 >= holes.length} onClick={() => setHolePageIndex(holePage + 1)}>Next</button>
          </div>}
        </section>
      )}
      <div className="three-d-divider" />
      <button
        type="button"
        className="secondary-button"
        onClick={() => objFileInputRef.current?.click()}
        disabled={Boolean(objLoading)}
      >
        Load OBJ meshes
      </button>
      <input
        ref={objFileInputRef}
        type="file"
        accept=".obj"
        multiple
        className="visually-hidden"
        onChange={e => loadObjFiles(e.target.files)}
      />
      {objLoading && <div role="status" className="three-d-section-help">{objLoading}</div>}
      {objError && <div role="alert" className="error-banner small">{objError}</div>}
      {selectedMesh && <section className="three-d-mesh-properties" aria-label="Selected mesh">
        <strong>{selectedMesh.name}</strong>
        <label>Colour <input type="color" value={selectedMesh.color} aria-label={`Colour of ${selectedMesh.name}`}
          onChange={event => changeMeshColor(selectedMesh.id, event.target.value)} /></label>
      </section>}
      {objMeshes.length > 0 && (
        <ul className="three-d-added-list" aria-label="OBJ meshes in scene">
          {objMeshes.map((mesh) => (
            <li key={mesh.id}>
              <button type="button" onClick={() => selectObjMesh(mesh.id)}
                aria-pressed={selectedMeshId === mesh.id}
                className="obj-mesh-select"
                title={`${mesh.name} (${mesh.vertexCount} vertices) — ${mesh.georeferenced ? 'georeferenced to project collars' : 'loaded in raw mesh coordinates'}`}
              >
                <span className="obj-mesh-swatch" style={{ background: mesh.color }} />{mesh.name}
              </button>
              {!mesh.georeferenced && (
                <span className="obj-mesh-flag" title={localGrid ? 'Supplied local coordinates retained.' : 'Loaded in source coordinates without a geographic transform.'}>
                  {localGrid ? 'local' : 'raw'}
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
                      <span className="drillhole-legend-swatch" style={{ background: colorForCategory(categoricalColorMap, cat, getCategoryHexColor(cat)) }} />
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

// Desurvey collars into the scene's local-metres frame.
//
// baselode's canonical desurvey takes collars in a projected frame
// (`easting` / `northing` / `elevation`, +Z up) and returns a flat array of
// station points in that same frame, so we seed it with the local frame the
// scene already draws in and the traces come back ready to render. Seeding
// the collar with its real RL puts survey-derived strings on the same
// vertical datum as collar-only holes; an unknown RL falls back to a 0 m
// datum, which is what the collar-relative traces used to give us.
//
// `step: null` keeps one vertex per survey station rather than resampling
// the trace every metre. The flat rows are regrouped per hole because that
// is the shape the scene (and the hole classification below) consumes.
function desurveyHolesInSceneFrame(collars, surveyRows, projectLatLng) {
  if (!surveyRows?.length || !projectLatLng) return [];
  const collarByKey = new Map();
  const canonicalCollars = [];
  for (const collar of collars || []) {
    const holeId = collar?.holeId;
    if (!holeId) continue;
    const key = normalizeHoleKey(holeId);
    if (collarByKey.has(key)) continue;
    const xy = projectLatLng(collar.lat, collar.lng, collar);
    if (!Number.isFinite(xy?.x) || !Number.isFinite(xy?.y)) continue;
    const elevation = Number(collar.elevation);
    collarByKey.set(key, collar);
    canonicalCollars.push({
      hole_id: holeId,
      easting: xy.x,
      northing: xy.y,
      elevation: Number.isFinite(elevation) ? elevation : 0,
    });
  }
  if (!canonicalCollars.length) return [];

  const points = minimumCurvatureDesurvey(canonicalCollars, surveyRows, { step: null }) || [];
  const byKey = new Map();
  for (const point of points) {
    const key = normalizeHoleKey(point?.hole_id);
    const collar = collarByKey.get(key);
    if (!collar) continue;
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;
    let hole = byKey.get(key);
    if (!hole) {
      hole = { id: collar.holeId, project: collar.project || '', points: [] };
      byKey.set(key, hole);
    }
    hole.points.push({ x: point.x, y: point.y, z: point.z, md: point.md });
  }
  return [...byKey.values()];
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
  const target = new THREE.Vector3(0, 0, 0);
  scene.controls.target.copy(target);
  scene.camera.position.set(target.x + distance, target.y + distance, target.z + distance);
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
  const longitudes = (collars || []).map((collar) => Number(collar?.lng)).filter(Number.isFinite);
  const meanLongitude = longitudes.length
    ? longitudes.reduce((sum, longitude) => sum + longitude, 0) / longitudes.length
    : null;
  const utmZone = Number.isFinite(meanLongitude)
    ? Math.floor((meanLongitude + 180) / 6) + 1
    : null;
  (collars || []).forEach((c) => {
    let e = Number(c?.easting);
    let n = Number(c?.northing);
    // Many collar exports carry only WGS84 lat/lng while OBJ exports use
    // projected MGA/UTM coordinates. Derive the projected control points so
    // the OBJ can still be fitted into the local collar frame.
    if ((!Number.isFinite(e) || !Number.isFinite(n)) && Number.isFinite(utmZone)) {
      const projected = latLngToUtm(c.lat, c.lng, utmZone);
      e = projected?.easting;
      n = projected?.northing;
    }
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
    projectLatLng: (latitude, longitude) => {
      const projected = latLngToUtm(latitude, longitude, utmZone);
      return projected ? { x: a * projected.easting - b * projected.northing + tx, y: b * projected.easting + a * projected.northing + ty } : null;
    },
    zone: utmZone,
    bbox: { minE, minN, maxE, maxN },
  };
}

function latLngToUtm(latitude, longitude, zone) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zone)) return null;
  const radians = Math.PI / 180;
  const phi = lat * radians;
  const lambda = lng * radians;
  const centralMeridian = ((zone - 1) * 6 - 180 + 3) * radians;
  const semiMajor = 6378137;
  const eccentricitySquared = 0.0066943799901413165;
  const eccentricityPrimeSquared = eccentricitySquared / (1 - eccentricitySquared);
  const scale = 0.9996;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  const radius = semiMajor / Math.sqrt(1 - eccentricitySquared * sinPhi * sinPhi);
  const tangent = tanPhi * tanPhi;
  const curvature = eccentricityPrimeSquared * cosPhi * cosPhi;
  const deltaLambda = cosPhi * (lambda - centralMeridian);
  const meridional = semiMajor * (
    (1 - eccentricitySquared / 4 - 3 * eccentricitySquared ** 2 / 64 - 5 * eccentricitySquared ** 3 / 256) * phi
      - (3 * eccentricitySquared / 8 + 3 * eccentricitySquared ** 2 / 32 + 45 * eccentricitySquared ** 3 / 1024) * Math.sin(2 * phi)
      + (15 * eccentricitySquared ** 2 / 256 + 45 * eccentricitySquared ** 3 / 1024) * Math.sin(4 * phi)
      - (35 * eccentricitySquared ** 3 / 3072) * Math.sin(6 * phi)
  );
  const easting = scale * radius * (
    deltaLambda + (1 - tangent + curvature) * deltaLambda ** 3 / 6
      + (5 - 18 * tangent + tangent ** 2 + 72 * curvature - 58 * eccentricityPrimeSquared) * deltaLambda ** 5 / 120
  ) + 500000;
  let northing = scale * (
    meridional + radius * tanPhi * (
      deltaLambda ** 2 / 2
      + (5 - tangent + 9 * curvature + 4 * curvature ** 2) * deltaLambda ** 4 / 24
      + (61 - 58 * tangent + tangent ** 2 + 600 * curvature - 330 * eccentricityPrimeSquared) * deltaLambda ** 6 / 720
    )
  );
  if (lat < 0) northing += 10000000;
  return { easting, northing };
}

// Whether a horizontal coordinate lands inside the project's grid extent (with a
// generous margin). Used to tell data that is in the projected CRS — and so
// should be reprojected to the local frame — apart from data already authored in
// local meters, which sits near the origin and must pass through untouched.
function isInProjectedRange(x, y, transform, margin = 50_000) {
  const { minE, minN, maxE, maxN } = transform.bbox;
  return x >= minE - margin && x <= maxE + margin && y >= minN - margin && y <= maxN + margin;
}

// Reproject a hole's points from projected grid coords into the local frame.
// Z (elevation) is shared by both frames, so only X/Y move. Returns the hole
// unchanged when there is no transform, or when its points already look local.
function toLocalFrameHole(hole, transform) {
  if (!transform) return hole;
  const sample = (hole.points || []).find((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  if (!sample || !isInProjectedRange(sample.x, sample.y, transform)) return hole;
  const points = (hole.points || []).map((p) => {
    const { x, y } = transform.apply(p.x, p.y);
    return { ...p, x, y };
  });
  return { ...hole, points };
}

// Reproject an OBJ group in place from projected grid coords to the local frame,
// but only when its horizontal centre falls within the project's grid extent.
// Leaves the X/Y untouched — and Z always — otherwise, so an OBJ already authored
// in local meters passes through unchanged. Returns whether the transform was
// applied. Vertex normals are (re)computed later in prepareObjMeshGroup, so we
// only need to move positions here.
function applyGeoreferenceIfInRange(group, transform) {
  if (!transform) return false;
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return false;
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  if (!isInProjectedRange(cx, cy, transform)) return false;
  group.traverse((child) => {
    const pos = child.isMesh ? child.geometry?.attributes?.position : null;
    if (!pos) return;
    for (let i = 0; i < pos.count; i += 1) {
      const { x, y } = transform.apply(pos.getX(i), pos.getY(i));
      pos.setXYZ(i, x, y, pos.getZ(i));
    }
    pos.needsUpdate = true;
    // setFromObject above cached bounding volumes in the source (UTM)
    // coordinates; recompute so bounds reconciliation and camera fitting
    // see the transformed mesh, not a box kilometres away.
    child.geometry.computeBoundingBox();
    child.geometry.computeBoundingSphere();
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
  // Clear on empty as well — Fit/Recenter read scene.lastBounds, and stale
  // bounds from removed content would steer the camera at deleted geometry.
  scene.lastBounds = hasBounds ? boundsFromBox(box) : null;
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
