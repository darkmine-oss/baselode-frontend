/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import {
  loadAssayFile,
  loadAssayFromRows,
  parseStructuralCSV,
  parseStructuralFromRows,
  parseSurveyCSV,
  parseSurveyFromRows,
  parseUnifiedDataset,
  parseGeologyCsvText,
  parseGeologyFromRows,
  standardizeColumns,
  HOLE_ID,
} from 'baselode';
import { isTauri, pickProjectFolder, readProjectFolder, readProjectFromFileList } from '../lib/projectIo.js';
import { buildSurveyStationIndex, resolveDipAzimuthRows } from '../lib/structuralOrientation.js';
import { parseSurfaceSamples } from '../lib/surfaceSamplesIo.js';
import { buildCategoricalColorMap } from '../lib/categoricalColors.js';

const LAST_PROJECT_KEY = 'baselode-viewer-last-project';

const initial = {
  status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
  folderPath: '',
  errors: {},
  collars: [],
  assayState: null,
  combinedHoles: [],
  structureRows: null,
  geologyHoles: [],
  surfaceSamples: [],
  categoricalColorMap: {},
  rawCsv: { precomputed: null, survey: null, colors: null },
  formats: {},
  openProject: async () => {},
  openProjectFromFileList: async () => {},
  closeProject: () => {},
};

const ProjectDataContext = createContext(initial);

export function ProjectDataProvider({ children }) {
  const [state, setState] = useState(initial);

  const closeProject = useCallback(() => {
    setState((s) => ({ ...s, status: 'idle', folderPath: '', errors: {}, collars: [], assayState: null, combinedHoles: [], structureRows: null, geologyHoles: [], surfaceSamples: [], categoricalColorMap: {}, rawCsv: { precomputed: null, survey: null, colors: null }, formats: {} }));
    try {
      localStorage.removeItem(LAST_PROJECT_KEY);
    } catch (e) {
      /* ignore */
    }
  }, []);

  const ingest = useCallback(async (read) => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const parsed = await parseProject(read);
      setState((s) => ({
        ...s,
        status: 'ready',
        folderPath: read.folderPath,
        errors: parsed.errors,
        collars: parsed.collars,
        assayState: parsed.assayState,
        combinedHoles: parsed.combinedHoles,
        structureRows: parsed.structureRows,
        geologyHoles: parsed.geologyHoles,
        surfaceSamples: parsed.surfaceSamples,
        categoricalColorMap: parsed.categoricalColorMap,
        rawCsv: { precomputed: read.files.precomputed_desurveyed || null, survey: read.files.survey || null, colors: read.files.colors || null },
        formats: read.formats || {},
      }));
      if (read.folderPath) {
        try { localStorage.setItem(LAST_PROJECT_KEY, read.folderPath); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      setState((s) => ({ ...s, status: 'error', errors: { load: e?.message || String(e) } }));
    }
  }, []);

  const openProject = useCallback(async () => {
    if (!isTauri()) {
      throw new Error('Use the in-browser folder input outside the desktop app.');
    }
    const folder = await pickProjectFolder();
    if (!folder) return;
    const read = await readProjectFolder(folder);
    await ingest(read);
  }, [ingest]);

  const openProjectFromFileList = useCallback(async (fileList) => {
    const read = await readProjectFromFileList(fileList);
    await ingest(read);
  }, [ingest]);

  // Try to restore the last project (desktop only — the folder path is
  // meaningless in a plain browser).
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      let last = null;
      try { last = localStorage.getItem(LAST_PROJECT_KEY); } catch (e) { /* ignore */ }
      if (!last) return;
      try {
        const read = await readProjectFolder(last);
        if (cancelled) return;
        await ingest(read);
      } catch (e) {
        console.info('Could not restore last project:', e?.message);
        try { localStorage.removeItem(LAST_PROJECT_KEY); } catch (err) { /* ignore */ }
      }
    })();
    return () => { cancelled = true; };
  }, [ingest]);

  const value = useMemo(() => ({
    ...state,
    openProject,
    openProjectFromFileList,
    closeProject,
  }), [state, openProject, openProjectFromFileList, closeProject]);

  return (
    <ProjectDataContext.Provider value={value}>
      {children}
    </ProjectDataContext.Provider>
  );
}

export function useProjectData() {
  return useContext(ProjectDataContext);
}

async function parseProject(read) {
  const { files } = read;
  const errors = {};
  const hasSource = (source) => (
    Array.isArray(source) ? source.length > 0 : Boolean(source)
  );

  // Collars — required.
  const collars = parseCollars(files.collars);

  // Assays — Parquet rows bypass CSV serialization and parsing.
  let assayState = null;
  if (hasSource(files.assays)) {
    try {
      if (Array.isArray(files.assays)) {
        assayState = loadAssayFromRows(files.assays, '');
      } else {
        const file = new File([new Blob([files.assays], { type: 'text/csv' })], 'assays.csv', { type: 'text/csv' });
        assayState = await loadAssayFile(file, '');
      }
    } catch (e) {
      errors.assays = e?.message || String(e);
    }
  }

  // Structural (parser returns a Promise).
  let structureRows = null;
  if (hasSource(files.structure)) {
    try {
      const parsed = Array.isArray(files.structure)
        ? parseStructuralFromRows(files.structure)
        : await parseStructuralCSV(files.structure);
      structureRows = parsed?.rows || null;
    } catch (e) {
      errors.structure = e?.message || String(e);
    }
  }

  // Geology (parser returns a Promise).
  let geologyHoles = [];
  if (hasSource(files.geology)) {
    try {
      const parsed = Array.isArray(files.geology)
        ? parseGeologyFromRows(files.geology)
        : await parseGeologyCsvText(files.geology);
      geologyHoles = parsed?.holes || [];
    } catch (e) {
      errors.geology = e?.message || String(e);
    }
  }

  // Combined hole records (assay + structural + geology unified by hole).
  let combinedHoles = [];
  if ([files.assays, files.structure, files.geology].some(hasSource)) {
    try {
      const unified = await parseUnifiedDataset({
        assayCsv: Array.isArray(files.assays) ? undefined : files.assays,
        structuralCsv: Array.isArray(files.structure) ? undefined : files.structure,
        geologyCsv: Array.isArray(files.geology) ? undefined : files.geology,
        assayRows: Array.isArray(files.assays) ? files.assays : undefined,
        structuralRows: Array.isArray(files.structure) ? files.structure : undefined,
        geologyRows: Array.isArray(files.geology) ? files.geology : undefined,
      });
      combinedHoles = unified?.holes || [];
    } catch (e) {
      errors.unified = e?.message || String(e);
    }
  }

  // Resolve structural orientations against the hole survey: alpha/beta-only
  // structural points gain derived dip/azimuth, which is what makes the
  // tadpole and dip/azimuth chart types work for oriented-core data.
  if (hasSource(files.survey) && combinedHoles.length) {
    try {
      const surveyRows = Array.isArray(files.survey)
        ? parseSurveyFromRows(files.survey)
        : await parseSurveyCSV(files.survey);
      const stationIndex = buildSurveyStationIndex(surveyRows || []);
      combinedHoles = resolveStructuralOrientations(combinedHoles, stationIndex);
    } catch (e) {
      errors.survey = e?.message || String(e);
    }
  }

  // Surface samples — out-of-hole sample points (rock chip / stream /
  // soil / outcrop) keyed by sample_id rather than hole_id.  Used by the
  // Analytics page.
  let surfaceSamples = [];
  if (hasSource(files.surface_samples)) {
    try {
      const parsed = parseSurfaceSamples(files.surface_samples);
      surfaceSamples = parsed?.rows || [];
    } catch (e) {
      errors.surface_samples = e?.message || String(e);
    }
  }
  const categoricalColorMap = buildCategoricalColorMap(geologyHoles, files.colors);

  return {
    collars,
    assayState,
    combinedHoles,
    structureRows,
    geologyHoles,
    surfaceSamples,
    categoricalColorMap,
    errors,
  };
}

/**
 * Resolve dip / azimuth for each combined hole's structural points.
 *
 * Points that already carry measured dip/azimuth pass through unchanged;
 * alpha/beta-only points gain derived dip/azimuth via the hole's survey
 * orientation at the measurement depth (tagged `orientation_source`).
 * Points `resolveDipAzimuthRows` would drop — no depth, or no orientation
 * information at all — are kept as-is so their categorical / comment columns
 * still reach the strip-log grid.
 *
 * @param {Array<{holeId: string, points: Array<Object>}>} holes - Combined holes
 * @param {Map<string, Array<Object>>} stationIndex - Survey stations per hole
 *   (from `buildSurveyStationIndex`)
 * @returns {Array<{holeId: string, points: Array<Object>}>}
 */
function resolveStructuralOrientations(holes, stationIndex) {
  return holes.map((hole) => {
    const stations = stationIndex.get(hole.holeId || hole.id);
    const points = (hole.points || []).map((point) => {
      if (point?._source !== 'structural') return point;
      const { rows } = resolveDipAzimuthRows([point], stations);
      return rows.length ? rows[0] : point;
    });
    return { ...hole, points };
  });
}

function parseCollars(source) {
  if (!source) return [];
  const rows = Array.isArray(source)
    ? source
    : Papa.parse(source, { header: true, skipEmptyLines: true }).data;
  return (rows || []).flatMap((row) => {
    const s = standardizeColumns(row);
    const lat = parseFloat(s.latitude);
    const lng = parseFloat(s.longitude);
    const easting = parseFloat(s.easting);
    const northing = parseFloat(s.northing);
    // Collar elevation (RL, metres). standardizeColumns folds elevation / rl /
    // elev / z onto `elevation`. NaN when the source omits it — consumers guard
    // with Number.isFinite. The 3D scene uses it to place holes that have no
    // desurveyed trace (collar-only) at their true height; without it such a
    // hole can't be positioned accurately in Z and is treated as "no survey".
    const elevation = parseFloat(s.elevation);
    const holeId = (s[HOLE_ID] || '').toString().trim();
    if (!holeId || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    return [{
      lat,
      lng,
      // Projected grid coordinates (UTM easting/northing) when the source
      // carries them. Used to georeference loaded OBJ meshes — which are in
      // the same projected CRS — into the scene's local-meters frame. NaN
      // when absent; consumers guard with Number.isFinite.
      easting,
      northing,
      elevation,
      holeId,
      // Leave empty when the source has no project_id / dataset
      // column.  Consumers that want a display fallback use `|| '—'`
      // or `|| 'N/A'` locally; the strip-log Project picker treats
      // an empty value as "no project filter" and surfaces a "No
      // projects" disabled option when every collar is empty.
      project: (s.project_id || s.dataset || '').toString().trim(),
    }];
  });
}
