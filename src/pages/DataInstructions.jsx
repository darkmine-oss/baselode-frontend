/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import './DataInstructions.css';

function DataInstructions() {
  return (
    <div className="data-instructions">
      <div className="data-instructions-content">
        <h1>Data Format Instructions</h1>
        <p className="lead">
          Baselode Viewer reads a folder of drillhole files. Open it from the sidebar via
          <em> Open project folder</em>. The viewer detects the canonical files below; each one
          can be supplied as either <code>.parquet</code> or <code>.csv</code>. When both exist
          for the same name, the Parquet copy wins (smaller, faster to parse).
        </p>

        <h2>Folder layout</h2>
        <pre className="folder-listing">{`my-project/
├── collars.{parquet,csv}                  (required)
├── survey.{parquet,csv}                   (needed for 3D)
├── assays.{parquet,csv}                   (drives "colour by" in 3D + Strip Log)
├── geology.{parquet,csv}                  (categorical colour-by)
├── structure.{parquet,csv}                (structural discs in 3D)
└── precomputed_desurveyed.{parquet,csv}   (optional — skip live desurvey)`}</pre>
        <p>
          Only <code>collars</code> is required. Missing files are skipped silently; the
          relevant viewer falls back to a placeholder.
        </p>

        <h2>Canonical schema</h2>
        <p>
          Column names match baselode&apos;s <code>standardizeColumns</code> aliases verbatim — the
          loader does no remapping. Common synonyms (e.g. <code>lat</code> for <code>latitude</code>,
          <code> md</code> for <code>depth</code>) are accepted because baselode standardises on read.
        </p>

        <table className="schema-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Required columns</th>
              <th>Common optional columns</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>collars</code></td>
              <td><code>hole_id</code>, <code>latitude</code>, <code>longitude</code></td>
              <td><code>elevation</code>, <code>datasource_hole_id</code>, <code>project_id</code>, <code>hole_type</code>, <code>max_depth</code></td>
            </tr>
            <tr>
              <td><code>survey</code></td>
              <td><code>hole_id</code>, <code>depth</code>, <code>azimuth</code>, <code>dip</code></td>
              <td>—</td>
            </tr>
            <tr>
              <td><code>assays</code></td>
              <td><code>hole_id</code>, <code>from</code>, <code>to</code></td>
              <td>one or more analyte columns (e.g. <code>Au_PPM</code>, <code>Cu_PCT</code>)</td>
            </tr>
            <tr>
              <td><code>geology</code></td>
              <td><code>hole_id</code>, <code>from</code>, <code>to</code></td>
              <td><code>geology_code</code>, <code>geology_description</code>, plus any intervalled attributes</td>
            </tr>
            <tr>
              <td><code>structure</code></td>
              <td><code>hole_id</code>, <code>depth</code>, <code>dip</code>, <code>azimuth</code></td>
              <td><code>alpha</code>, <code>beta</code>, <code>strike</code></td>
            </tr>
            <tr>
              <td><code>precomputed_desurveyed</code></td>
              <td><code>hole_id</code>, <code>x</code>, <code>y</code>, <code>z</code>, <code>md</code></td>
              <td>—  (already-projected, scene-frame XYZ)</td>
            </tr>
          </tbody>
        </table>

        <p>
          <code>hole_id</code> is the join key across files — use the same string everywhere.
        </p>

        <h2>Projection</h2>
        <p>
          Collar latitude/longitude are projected to a <strong>local tangent plane</strong>
          centred on the collar centroid (metres east/north). For projects spanning under ~100 km
          this is visually indistinguishable from a per-zone UTM; for continental-scale data,
          supply a <code>precomputed_desurveyed</code> file produced with your own projection.
        </p>
      </div>
    </div>
  );
}

export default DataInstructions;
