/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useMemo, useState } from 'react';
import {
  PlotPanel,
  PropertySelect,
  LogToggle,
  buildTwoCurveFillConfig,
  buildCompositionConfig,
  buildPointLogConfig,
  buildDepthAnnotationsConfig,
  buildDipAzimuthConfig,
  buildTadpoleConfig,
  parseSurveyCSV,
  BASELODE_TEMPLATE,
  BASELODE_DARK_TEMPLATE,
  HOLE_ID,
  DEPTH,
} from 'baselode';
import './AdvancedStripLogs.css';
import { useProjectData } from '../context/ProjectDataContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { buildSurveyStationIndex, resolveDipAzimuthRows } from '../lib/structuralOrientation.js';

// Row geometry / bookkeeping columns — never offered as plottable properties.
const RESERVED_COLUMNS = new Set([
  'hole_id', 'from', 'to', 'mid', 'depth', 'md', '_source',
  'sample_id', 'datasource_sample_id', 'datasource_hole_id', 'collar_id',
  'report_number', 'orientation_source', 'extra',
]);

/** Numeric assay columns for one hole, most-populated first. @private */
function numericPropertiesForHole(hole) {
  const counts = new Map();
  for (const row of hole?.points || []) {
    if (row?._source && row._source !== 'assay') continue;
    for (const [key, value] of Object.entries(row || {})) {
      if (RESERVED_COLUMNS.has(key)) continue;
      if (value == null || (typeof value === 'string' && value.trim() === '')) continue;
      if (!Number.isFinite(Number(value))) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}

/**
 * Split a structure table's columns into categorical (2–40 distinct,
 * majority non-numeric) and free-text candidates. @private
 */
function structureColumnKinds(rows) {
  const stats = new Map();
  for (const row of rows || []) {
    for (const [key, value] of Object.entries(row || {})) {
      if (RESERVED_COLUMNS.has(key)) continue;
      if (value == null || (typeof value === 'string' && value.trim() === '')) continue;
      if (!stats.has(key)) stats.set(key, { distinct: new Set(), numeric: 0, total: 0 });
      const entry = stats.get(key);
      entry.distinct.add(String(value));
      entry.total += 1;
      if (Number.isFinite(Number(value))) entry.numeric += 1;
    }
  }
  const categorical = [];
  const text = [];
  for (const [key, entry] of stats.entries()) {
    if (entry.numeric * 2 > entry.total) continue;
    if (entry.distinct.size >= 2 && entry.distinct.size <= 40) categorical.push(key);
    else if (entry.distinct.size > 40) text.push(key);
  }
  return { categorical, text };
}

function AdvancedStripLogs() {
  const { combinedHoles, structureRows, rawCsv, status } = useProjectData();
  const { theme } = useTheme();
  const template = theme === 'dark' ? BASELODE_DARK_TEMPLATE : BASELODE_TEMPLATE;

  // ----- assay-driven panels (two-curve fill, composition) -----
  const assayHoles = useMemo(
    () => (combinedHoles || []).filter((hole) => numericPropertiesForHole(hole).length >= 2),
    [combinedHoles],
  );
  const assayHoleIds = useMemo(
    () => assayHoles.map((hole) => hole.holeId || hole.id).filter(Boolean),
    [assayHoles],
  );

  const [curveHoleId, setCurveHoleId] = useState('');
  const [curvePropertyA, setCurvePropertyA] = useState('');
  const [curvePropertyB, setCurvePropertyB] = useState('');
  const [curveLogScale, setCurveLogScale] = useState(false);

  const curveHole = useMemo(
    () => assayHoles.find((hole) => (hole.holeId || hole.id) === (curveHoleId || assayHoleIds[0])) || null,
    [assayHoles, curveHoleId, assayHoleIds],
  );
  const curveProperties = useMemo(() => numericPropertiesForHole(curveHole), [curveHole]);
  const effectivePropertyA = curvePropertyA && curveProperties.includes(curvePropertyA)
    ? curvePropertyA : curveProperties[0] || '';
  const effectivePropertyB = curvePropertyB && curveProperties.includes(curvePropertyB) && curvePropertyB !== effectivePropertyA
    ? curvePropertyB : curveProperties.find((property) => property !== effectivePropertyA) || '';

  const twoCurveConfig = useMemo(() => {
    if (!curveHole || !effectivePropertyA || !effectivePropertyB) return { data: [], layout: {} };
    return buildTwoCurveFillConfig({
      hole: curveHole,
      propertyA: effectivePropertyA,
      propertyB: effectivePropertyB,
      logScale: curveLogScale,
      template,
    });
  }, [curveHole, effectivePropertyA, effectivePropertyB, curveLogScale, template]);

  const [compositionHoleId, setCompositionHoleId] = useState('');
  const [compositionPicks, setCompositionPicks] = useState(['', '', '']);
  const compositionHole = useMemo(
    () => assayHoles.find((hole) => (hole.holeId || hole.id) === (compositionHoleId || assayHoleIds[0])) || null,
    [assayHoles, compositionHoleId, assayHoleIds],
  );
  const compositionProperties = useMemo(() => numericPropertiesForHole(compositionHole), [compositionHole]);
  const effectiveComponents = useMemo(() => {
    const chosen = compositionPicks.filter((pick) => pick && compositionProperties.includes(pick));
    if (chosen.length >= 2) return [...new Set(chosen)];
    return compositionProperties.slice(0, 3);
  }, [compositionPicks, compositionProperties]);

  const compositionConfig = useMemo(() => {
    if (!compositionHole || effectiveComponents.length < 2) return { data: [], layout: {} };
    return buildCompositionConfig({ hole: compositionHole, properties: effectiveComponents, template });
  }, [compositionHole, effectiveComponents, template]);

  // ----- structural panels -----
  const structureByHole = useMemo(() => {
    const byHole = new Map();
    for (const row of structureRows || []) {
      const holeId = row?.[HOLE_ID] != null ? `${row[HOLE_ID]}`.trim() : '';
      if (!holeId) continue;
      if (!byHole.has(holeId)) byHole.set(holeId, []);
      byHole.get(holeId).push(row);
    }
    return byHole;
  }, [structureRows]);
  const structureHoleIds = useMemo(() => [...structureByHole.keys()].sort(), [structureByHole]);

  // parseSurveyCSV is async (papaparse under the hood) and accepts the raw
  // CSV text held in rawCsv.survey.
  const [surveyIndex, setSurveyIndex] = useState(() => new Map());
  useEffect(() => {
    let cancelled = false;
    if (!rawCsv?.survey) {
      setSurveyIndex(new Map());
      return undefined;
    }
    parseSurveyCSV(rawCsv.survey)
      .then((rows) => {
        if (!cancelled) setSurveyIndex(buildSurveyStationIndex(rows || []));
      })
      .catch((error) => {
        console.warn('Survey CSV parse failed; alpha/beta orientations unavailable', error);
        if (!cancelled) setSurveyIndex(new Map());
      });
    return () => { cancelled = true; };
  }, [rawCsv?.survey]);

  const [structureHoleId, setStructureHoleId] = useState('');
  const effectiveStructureHoleId = structureHoleId && structureByHole.has(structureHoleId)
    ? structureHoleId : structureHoleIds[0] || '';
  const holeStructureRows = structureByHole.get(effectiveStructureHoleId) || [];

  const { categorical: structureCategoricalColumns, text: structureTextColumns } = useMemo(
    () => structureColumnKinds(holeStructureRows),
    [holeStructureRows],
  );

  const [pointCategory, setPointCategory] = useState('');
  const effectivePointCategory = pointCategory && structureCategoricalColumns.includes(pointCategory)
    ? pointCategory : structureCategoricalColumns[0] || '';

  const [annotationColumn, setAnnotationColumn] = useState('');
  const annotationOptions = [...structureTextColumns, ...structureCategoricalColumns];
  const effectiveAnnotationColumn = annotationColumn && annotationOptions.includes(annotationColumn)
    ? annotationColumn : annotationOptions[0] || '';

  const resolvedOrientation = useMemo(
    () => resolveDipAzimuthRows(holeStructureRows, surveyIndex.get(effectiveStructureHoleId)),
    [holeStructureRows, surveyIndex, effectiveStructureHoleId],
  );

  const pointLogConfig = useMemo(() => {
    if (!holeStructureRows.length || !effectivePointCategory) return { data: [], layout: {} };
    return buildPointLogConfig({
      rows: holeStructureRows,
      depthKey: DEPTH,
      categoryKey: effectivePointCategory,
      template,
    });
  }, [holeStructureRows, effectivePointCategory, template]);

  const annotationsConfig = useMemo(() => {
    if (!holeStructureRows.length || !effectiveAnnotationColumn) return { data: [], layout: {} };
    return buildDepthAnnotationsConfig({
      rows: holeStructureRows,
      depthKey: DEPTH,
      textKey: effectiveAnnotationColumn,
      template,
    });
  }, [holeStructureRows, effectiveAnnotationColumn, template]);

  const dipAzimuthConfig = useMemo(() => {
    if (!resolvedOrientation.rows.length) return { data: [], layout: {} };
    return buildDipAzimuthConfig({
      rows: resolvedOrientation.rows,
      colorBy: resolvedOrientation.derivedCount > 0 ? 'orientation_source' : null,
      template,
    });
  }, [resolvedOrientation, template]);

  const tadpoleConfig = useMemo(() => {
    if (!resolvedOrientation.rows.length) return { data: [], layout: {} };
    return buildTadpoleConfig(resolvedOrientation.rows, {
      colorBy: effectivePointCategory || null,
      template,
    });
  }, [resolvedOrientation, effectivePointCategory, template]);

  const orientationSummary = resolvedOrientation.rows.length
    ? `${resolvedOrientation.measuredCount} measured · ${resolvedOrientation.derivedCount} derived from α/β via the hole survey`
    : (surveyIndex.size
      ? 'No rows with measured dip/azimuth or convertible α/β angles.'
      : 'No survey file loaded — α/β angles cannot be converted to dip/azimuth.');

  if (status !== 'ready') {
    return (
      <div className="page-empty-state">
        <h2>No project loaded</h2>
        <p>Open a project folder to use the advanced strip-log tracks.</p>
      </div>
    );
  }

  return (
    <div className="advanced-strip-logs">
      <header className="advanced-strip-logs__header">
        <h1>Advanced Strip Logs</h1>
        <p>Specialist downhole tracks: cross-plot fills, composition, and structural logs.</p>
      </header>

      <div className="advanced-strip-logs__grid">
        <PlotPanel
          title="Two-curve fill"
          description="Two numeric curves with the band between them shaded by dominance, flipping colour at each crossover."
          controls={assayHoleIds.length ? (
            <>
              <PropertySelect label="hole" value={curveHoleId || assayHoleIds[0] || ''} onChange={setCurveHoleId} options={assayHoleIds} />
              <PropertySelect label="curve A" value={effectivePropertyA} onChange={setCurvePropertyA} options={curveProperties} />
              <PropertySelect label="curve B" value={effectivePropertyB} onChange={setCurvePropertyB} options={curveProperties} />
              <LogToggle label="Log scale" value={curveLogScale} onChange={setCurveLogScale} />
            </>
          ) : <p className="advanced-strip-logs__note">No holes with two or more numeric assay columns.</p>}
          data={twoCurveConfig.data}
          layout={twoCurveConfig.layout}
          height={520}
        />

        <PlotPanel
          title="Composition"
          description="Normalised assay composition — each interval's selected analytes scaled to fractions of their sum (not a true modal lithology composition)."
          controls={assayHoleIds.length ? (
            <>
              <PropertySelect label="hole" value={compositionHoleId || assayHoleIds[0] || ''} onChange={setCompositionHoleId} options={assayHoleIds} />
              {[0, 1, 2].map((slotIndex) => (
                <PropertySelect
                  key={slotIndex}
                  label={`analyte ${slotIndex + 1}`}
                  value={compositionPicks[slotIndex] || effectiveComponents[slotIndex] || ''}
                  onChange={(next) => setCompositionPicks((prev) => prev.map(
                    (current, pickIndex) => (pickIndex === slotIndex ? next : current)
                  ))}
                  options={compositionProperties}
                  includeBlank={slotIndex === 2}
                />
              ))}
            </>
          ) : <p className="advanced-strip-logs__note">No holes with two or more numeric assay columns.</p>}
          data={compositionConfig.data}
          layout={compositionConfig.layout}
          height={520}
        />
      </div>

      <header className="advanced-strip-logs__header advanced-strip-logs__header--section">
        <h2>Structural logs</h2>
        {structureHoleIds.length ? (
          <div className="advanced-strip-logs__structure-controls">
            <PropertySelect label="hole" value={effectiveStructureHoleId} onChange={setStructureHoleId} options={structureHoleIds} />
            <span className="advanced-strip-logs__note">{orientationSummary}</span>
          </div>
        ) : (
          <p className="advanced-strip-logs__note">No structure file in this project — structural logs need a structure CSV.</p>
        )}
      </header>

      {structureHoleIds.length > 0 && (
        <div className="advanced-strip-logs__grid advanced-strip-logs__grid--structural">
          <PlotPanel
            title="Point log"
            description="Point measurements by category — one column, colour and symbol per category."
            controls={(
              <PropertySelect label="category" value={effectivePointCategory} onChange={setPointCategory} options={structureCategoricalColumns} />
            )}
            data={pointLogConfig.data}
            layout={pointLogConfig.layout}
            height={520}
          />
          <PlotPanel
            title="Depth annotations"
            description="Free-text annotations pinned to their measured depth."
            controls={(
              <PropertySelect label="text" value={effectiveAnnotationColumn} onChange={setAnnotationColumn} options={annotationOptions} />
            )}
            data={annotationsConfig.data}
            layout={annotationsConfig.layout}
            height={520}
          />
          <PlotPanel
            title="Dip / azimuth"
            description="Split dip-magnitude (0–90°) and dip-direction (0–360°) tracks."
            data={dipAzimuthConfig.data}
            layout={dipAzimuthConfig.layout}
            height={520}
          />
          <PlotPanel
            title="Tadpole"
            description="Dip magnitude with azimuth tails; coloured by the selected category."
            data={tadpoleConfig.data}
            layout={tadpoleConfig.layout}
            height={520}
          />
        </div>
      )}
    </div>
  );
}

export default AdvancedStripLogs;
