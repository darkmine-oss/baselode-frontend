/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// Persists per-panel strip-log config (holeId / property / chartType)
// across route navigation so leaving the Strip Log page and coming
// back doesn't reset what the user picked.

const INITIAL = {
  // Array of `{ holeId, property, chartType, projectId, logScale,
  // usePatterns }` keyed by panel index.  Sparse — index N exists only
  // if that panel has been touched.  `projectId` is the optional group
  // filter; '' means unfiltered (every hole is visible in the hole
  // dropdown).  `logScale` / `usePatterns` are the per-track display
  // toggles folded into the TracePlot config.
  configs: [],
};

const StripLogSelectionsContext = createContext(null);

export function StripLogSelectionsProvider({ children }) {
  const [selections, setSelections] = useState(INITIAL);

  // Replace the whole configs array (used when the page mirrors the
  // hook's current trace graphs back into the cache).  Preserves the
  // per-panel `projectId` / `logScale` / `usePatterns` from the prior
  // cache entry — they don't come from `useDrillholeTraceGrid`, so the
  // mirror would otherwise wipe them on every panel edit.
  const setAllConfigs = useCallback((configs) => {
    setSelections((current) => ({
      ...current,
      configs: (configs || []).map((next, idx) => {
        const prior = current.configs[idx];
        const projectId = next?.projectId ?? prior?.projectId ?? '';
        const logScale = next?.logScale ?? prior?.logScale ?? false;
        const usePatterns = next?.usePatterns ?? prior?.usePatterns ?? false;
        return next ? { ...next, projectId, logScale, usePatterns } : null;
      }),
    }));
  }, []);

  // Patch a single panel — used for picks (like the project filter)
  // that aren't part of the trace-grid hook's per-panel config.
  const setPanelPatch = useCallback((index, patch) => {
    setSelections((current) => {
      const configs = [...current.configs];
      const existing = configs[index] || { holeId: '', property: '', chartType: '', projectId: '' };
      configs[index] = { ...existing, ...patch };
      return { ...current, configs };
    });
  }, []);

  // Reset all panels — currently unused, exposed so a future "clear"
  // affordance has a single entry point.
  const reset = useCallback(() => setSelections(INITIAL), []);

  const value = useMemo(
    () => ({ selections, setAllConfigs, setPanelPatch, reset }),
    [selections, setAllConfigs, setPanelPatch, reset],
  );

  return (
    <StripLogSelectionsContext.Provider value={value}>
      {children}
    </StripLogSelectionsContext.Provider>
  );
}

export function useStripLogSelections() {
  const context = useContext(StripLogSelectionsContext);
  if (!context) {
    throw new Error('useStripLogSelections must be used within StripLogSelectionsProvider');
  }
  return context;
}
