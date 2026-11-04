/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useProjectData } from './ProjectDataContext.jsx';
import { loadRasterSource } from '../lib/geophysicsIo.js';
import { defaultProcessingParams, processingRequest } from '../lib/geophysicsProcessing.js';

// Keeps the geophysics grid list, the shown grid and its display settings
// across route navigation, so returning to the page doesn't re-read a large
// grid or reset the colour scale.

// Histogram-equalised turbo with hillshade is the usual first look at
// magnetics and gravity grids.
export const DEFAULT_GEOPHYSICS_VIEW = Object.freeze({
  palette: 'turbo',
  reversePalette: false,
  stretch: { mode: 'equalize' },
  hillshade: { enabled: true, azimuth: 315, altitude: 45, strength: 0.5, zFactor: 'auto' },
});

const IDLE = { id: '', source: null, status: 'idle', raster: null, error: '' };
const NO_PROCESSING = { id: 'none', params: {} };
// `key` names the grid and band a result belongs to, so a previous grid's
// result is never shown under a newly selected one.
const UNPROCESSED = { status: 'idle', raster: null, error: '', key: '' };
// The field direction applies to every grid of a survey area; distances are
// re-derived from each grid's size.
const KEPT_PARAMS = ['inclination', 'declination'];
// Wait for typing to pause before re-running a Fourier transform.
const PROCESS_DELAY_MS = 300;

/** One band of a raster as its own single-band raster. */
async function bandRaster(raster, band) {
  if (raster.bandCount === 1) return raster;
  const { createGeophysicsRaster } = await import('baselode');
  return createGeophysicsRaster({
    data: [raster.data[band - 1]],
    transform: raster.transform,
    crs: raster.crs,
    nodata: raster.nodata,
    bandNames: [raster.bandNames[band - 1]],
    metadata: { ...raster.metadata, units: [raster.metadata?.units?.[band - 1] ?? null] },
  });
}

const GeophysicsContext = createContext(null);

export function GeophysicsProvider({ children }) {
  const { rasterSources } = useProjectData();
  const [opened, setOpened] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [band, setBand] = useState(1);
  const [view, setView] = useState(DEFAULT_GEOPHYSICS_VIEW);
  const [loaded, setLoaded] = useState(IDLE);
  const [processing, setProcessing] = useState(NO_PROCESSING);
  const [processed, setProcessed] = useState(UNPROCESSED);
  // Grids are read only while the Geophysics page is shown, so opening a
  // project doesn't decode large grids for other pages.
  const [active, setActive] = useState(false);

  const sources = useMemo(() => [...(rasterSources || []), ...opened], [rasterSources, opened]);
  const selected = sources.find((source) => source.id === selectedId) ?? sources[0] ?? null;

  useEffect(() => {
    if (!selected) {
      setLoaded(IDLE);
      return undefined;
    }
    // Reuse a finished load of this exact source (e.g. after navigating
    // away). A reopened project brings new source objects, so its grids are
    // read again, and a load cancelled part-way is always restarted.
    if (loaded.source === selected && loaded.status !== 'loading') return undefined;
    if (!active) return undefined;
    let cancelled = false;
    const base = { id: selected.id, source: selected, raster: null, error: '' };
    if (loaded.id !== selected.id) {
      setBand(1);
      setProcessing((current) => ({
        ...current,
        params: Object.fromEntries(Object.entries(current.params).filter(([key]) => KEPT_PARAMS.includes(key))),
      }));
    }
    setLoaded({ ...base, status: 'loading' });
    loadRasterSource(selected).then(
      (raster) => { if (!cancelled) setLoaded({ ...base, status: 'ready', raster }); },
      (error) => { if (!cancelled) setLoaded({ ...base, status: 'error', error: error?.message || String(error) }); },
    );
    return () => { cancelled = true; };
    // `loaded` is only consulted to skip reloading the grid already shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, active]);

  const shownRaster = selected && loaded.id === selected.id ? loaded.raster : null;
  const processingParams = useMemo(
    () => (shownRaster ? { ...defaultProcessingParams(shownRaster), ...processing.params } : processing.params),
    [shownRaster, processing.params],
  );

  // Run the chosen operation on the shown band. Processing yields to the
  // browser first so the page can show progress, and a newer request
  // supersedes an older one.
  useEffect(() => {
    if (!shownRaster || processing.id === 'none') {
      setProcessed(UNPROCESSED);
      return undefined;
    }
    const shownBand = Math.min(band, shownRaster.bandCount);
    const key = `${selected.id}:${shownBand}`;
    let request;
    try {
      request = processingRequest(processing.id, processingParams, shownRaster);
    } catch (error) {
      setProcessed({ ...UNPROCESSED, status: 'error', error: error.message, key });
      return undefined;
    }
    let cancelled = false;
    setProcessed((current) => ({ ...current, status: 'processing', error: '' }));
    const timer = setTimeout(async () => {
      try {
        const { processGeophysicsRaster } = await import('baselode');
        const result = processGeophysicsRaster(await bandRaster(shownRaster, shownBand), request.operation, request.options);
        if (!cancelled) setProcessed({ status: 'ready', raster: result, error: '', key });
      } catch (error) {
        if (!cancelled) setProcessed({ ...UNPROCESSED, status: 'error', error: error?.message || String(error), key });
      }
    }, PROCESS_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `selected` changes only with `shownRaster`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownRaster, band, processing.id, processingParams]);

  const setProcessingId = useCallback((id) => setProcessing((current) => ({ ...current, id })), []);
  const setProcessingParam = useCallback((key, value) => {
    setProcessing((current) => ({ ...current, params: { ...current.params, [key]: value } }));
  }, []);

  const addOpened = useCallback((next) => {
    if (!next.length) return;
    // Reopened files replace their earlier sources (and so are read again),
    // e.g. an ERS header first opened without its data file.
    setOpened((current) => {
      const replaced = new Set(next.map((source) => source.id));
      return [...current.filter((source) => !replaced.has(source.id)), ...next];
    });
    setSelectedId(next[0].id);
  }, []);

  const removeOpened = useCallback((id) => {
    setOpened((current) => current.filter((source) => source.id !== id));
  }, []);

  const value = useMemo(() => ({
    sources,
    selected,
    select: setSelectedId,
    addOpened,
    removeOpened,
    loaded: selected && loaded.id === selected.id ? loaded : IDLE,
    band,
    setBand,
    view,
    setView,
    setActive,
    processingId: processing.id,
    processingParams,
    setProcessingId,
    setProcessingParam,
    processed,
  }), [sources, selected, addOpened, removeOpened, loaded, band, view, processing.id, processingParams,
    setProcessingId, setProcessingParam, processed]);

  return <GeophysicsContext.Provider value={value}>{children}</GeophysicsContext.Provider>;
}

export function useGeophysics() {
  return useContext(GeophysicsContext);
}
