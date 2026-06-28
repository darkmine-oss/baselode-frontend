/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import {
  loadAssayFile,
  parseStructuralCSV,
  parseUnifiedDataset,
  parseGeologyCsvText,
  standardizeColumns,
  HOLE_ID,
} from 'baselode';
import { isTauri, pickProjectFolder, readProjectFolder, readProjectFromFileList } from '../lib/projectIo.js';
import { parseSurfaceSamples } from '../lib/surfaceSamplesIo.js';

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
  rawCsv: { precomputed: null, survey: null },
  formats: {},
  openProject: async () => {},
  openProjectFromFileList: async () => {},
  closeProject: () => {},
};

const ProjectDataContext = createContext(initial);

export function ProjectDataProvider({ children }) {
  const [state, setState] = useState(initial);

  const closeProject = useCallback(() => {
    setState((s) => ({ ...s, status: 'idle', folderPath: '', errors: {}, collars: [], assayState: null, combinedHoles: [], structureRows: null, geologyHoles: [], surfaceSamples: [], rawCsv: { precomputed: null, survey: null }, formats: {} }));
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
        rawCsv: { precomputed: read.files.precomputed_desurveyed || null, survey: read.files.survey || null },
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

  // Collars — required.
  const collars = parseCollars(files.collars);

  // Assays — load via baselode (it wants a File).
  let assayState = null;
  if (files.assays) {
    try {
      const file = new File([new Blob([files.assays], { type: 'text/csv' })], 'assays.csv', { type: 'text/csv' });
      assayState = await loadAssayFile(file, '');
    } catch (e) {
      errors.assays = e?.message || String(e);
    }
  }

  // Structural (parser returns a Promise).
  let structureRows = null;
  if (files.structure) {
    try {
      const parsed = await parseStructuralCSV(files.structure);
      structureRows = parsed?.rows || null;
    } catch (e) {
      errors.structure = e?.message || String(e);
    }
  }

  // Geology (parser returns a Promise).
  let geologyHoles = [];
  if (files.geology) {
    try {
      const parsed = await parseGeologyCsvText(files.geology);
      geologyHoles = parsed?.holes || [];
    } catch (e) {
      errors.geology = e?.message || String(e);
    }
  }

  // Combined hole records (assay + structural + geology unified by hole).
  let combinedHoles = [];
  if (files.assays || files.structure || files.geology) {
    try {
      const unified = await parseUnifiedDataset({
        assayCsv: files.assays || '',
        structuralCsv: files.structure || '',
        geologyCsv: files.geology || '',
      });
      combinedHoles = unified?.holes || [];
    } catch (e) {
      errors.unified = e?.message || String(e);
    }
  }

  // Surface samples — out-of-hole sample points (rock chip / stream /
  // soil / outcrop) keyed by sample_id rather than hole_id.  Used by the
  // Analytics page.
  let surfaceSamples = [];
  if (files.surface_samples) {
    try {
      const parsed = parseSurfaceSamples(files.surface_samples);
      surfaceSamples = parsed?.rows || [];
    } catch (e) {
      errors.surface_samples = e?.message || String(e);
    }
  }

  return {
    collars,
    assayState,
    combinedHoles,
    structureRows,
    geologyHoles,
    surfaceSamples,
    errors,
  };
}

function parseCollars(csvText) {
  if (!csvText) return [];
  const { data } = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  return (data || []).flatMap((row) => {
    const s = standardizeColumns(row);
    const lat = parseFloat(s.latitude);
    const lng = parseFloat(s.longitude);
    const easting = parseFloat(s.easting);
    const northing = parseFloat(s.northing);
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
