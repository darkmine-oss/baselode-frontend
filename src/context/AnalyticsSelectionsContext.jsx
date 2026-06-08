/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// Persists per-plot Analytics dropdown picks across route navigation.
// State lives at the layout level so unmounting / remounting the
// Analytics page on route changes doesn't reset what the user picked.

const INITIAL = {
  source: '',
  scatter: { x: '', y: '', colorBy: '', logX: true, logY: true },
  histogram: { prop: '', groupBy: '', logY: true, barmode: 'overlay' },
  box: { prop: '', groupBy: '', logY: true },
  violin: { prop: '', groupBy: '', logY: true },
  ternary: { a: '', b: '', c: '', colorBy: '' },
};

const PLOT_GROUPS = ['scatter', 'histogram', 'box', 'violin', 'ternary'];

const AnalyticsSelectionsContext = createContext(null);

function applyPatch(current, patchOrFn) {
  const patch = typeof patchOrFn === 'function' ? patchOrFn(current) : patchOrFn;
  return { ...current, ...patch };
}

export function AnalyticsSelectionsProvider({ children }) {
  const [selections, setSelections] = useState(INITIAL);

  const setSource = useCallback((next) => {
    setSelections((current) => ({
      ...current,
      source: typeof next === 'function' ? next(current.source) : next,
    }));
  }, []);

  // One stable per-plot updater that accepts either a flat patch object
  // or a (current) => patch function (functional form needed by the
  // seeding effect, which must read current picks without listing them
  // as effect deps).
  const setPlot = useCallback((group, patchOrFn) => {
    setSelections((current) => ({
      ...current,
      [group]: applyPatch(current[group], patchOrFn),
    }));
  }, []);

  // Reset every per-plot group back to its initial picks but preserve
  // the active source (callers that want to wipe source too can pass it
  // through `setSource('')`).  Used when the data source switches and
  // the previously-picked columns may no longer exist.
  const resetPlotPicks = useCallback(() => {
    setSelections((current) => {
      const next = { ...current };
      for (const group of PLOT_GROUPS) next[group] = INITIAL[group];
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ selections, setSource, setPlot, resetPlotPicks }),
    [selections, setSource, setPlot, resetPlotPicks],
  );

  return (
    <AnalyticsSelectionsContext.Provider value={value}>
      {children}
    </AnalyticsSelectionsContext.Provider>
  );
}

export function useAnalyticsSelections() {
  const context = useContext(AnalyticsSelectionsContext);
  if (!context) {
    throw new Error('useAnalyticsSelections must be used within AnalyticsSelectionsProvider');
  }
  return context;
}
