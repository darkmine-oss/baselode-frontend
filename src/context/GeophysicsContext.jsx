/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useProjectData } from './ProjectDataContext.jsx';
import { loadRasterSource } from '../lib/geophysicsIo.js';

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

const IDLE = { id: '', status: 'idle', raster: null, error: '' };

const GeophysicsContext = createContext(null);

export function GeophysicsProvider({ children }) {
  const { rasterSources } = useProjectData();
  const [opened, setOpened] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [band, setBand] = useState(1);
  const [view, setView] = useState(DEFAULT_GEOPHYSICS_VIEW);
  const [loaded, setLoaded] = useState(IDLE);

  const sources = useMemo(() => [...(rasterSources || []), ...opened], [rasterSources, opened]);
  const selected = sources.find((source) => source.id === selectedId) ?? sources[0] ?? null;

  useEffect(() => {
    if (!selected) {
      setLoaded(IDLE);
      return undefined;
    }
    if (loaded.id === selected.id) return undefined;
    let cancelled = false;
    setLoaded({ id: selected.id, status: 'loading', raster: null, error: '' });
    setBand(1);
    loadRasterSource(selected).then(
      (raster) => { if (!cancelled) setLoaded({ id: selected.id, status: 'ready', raster, error: '' }); },
      (error) => { if (!cancelled) setLoaded({ id: selected.id, status: 'error', raster: null, error: error?.message || String(error) }); },
    );
    return () => { cancelled = true; };
    // `loaded` is only consulted to skip a reload of the grid already shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const addOpened = useCallback((next) => {
    if (!next.length) return;
    setOpened((current) => {
      const known = new Set(current.map((source) => source.id));
      return [...current, ...next.filter((source) => !known.has(source.id))];
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
  }), [sources, selected, addOpened, removeOpened, loaded, band, view]);

  return <GeophysicsContext.Provider value={value}>{children}</GeophysicsContext.Provider>;
}

export function useGeophysics() {
  return useContext(GeophysicsContext);
}
