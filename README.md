# Baselode Viewer

Desktop drilling-data viewer by **[Darkmine](https://darkmine.ai)**, built as a React/Vite app wrapped
in [Tauri v2](https://v2.tauri.app/) for distribution as a native Windows `.exe`
(and macOS / Linux binaries). The UI is a lightweight wrapper around the
[`baselode`](https://www.npmjs.com/package/baselode) library — open a project
folder of CSVs and explore the holes on a map, in 3D, and as strip logs.

## Features

- **Map** — collars plotted on OpenStreetMap with clustering, hole search, and
  a per-hole quick-look chart.
- **3D Scene** — desurveyed drillhole traces with optional structural discs,
  geology-categorical and assay-numeric colouring, and depth strip logs.
- **Strip Log** — N-up grid of independent depth plots (Plotly), one per
  panel.  Each panel has its own Project / Hole / Property /
  Chart-type dropdowns; the Project filter narrows the hole list to a
  single `project_id`, and is automatically hidden as "No projects"
  when the data carries no project column.  Per-panel picks persist
  across page navigation, so opening the 3D Scene and coming back
  keeps the grid configured.
- **Analytics** — scatter / histogram / box / violin / ternary plots over
  the loaded drillhole assays or surface samples, with categorical
  colouring (lithology, sample type, etc.).  Each plot has its own
  property / group-by / log-axis controls, and your picks persist across
  page navigation so switching to the 3D scene and back doesn't lose
  what you'd set up.

The Drillhole Block Model and Polygon Grade Blocks viewers from the upstream
demo are intentionally **out of scope** for this app.

## Expected project folder structure

Pick a folder from the sidebar's **Open project folder** button. The folder
should contain one or more of the canonical files below — each can be **either
`.parquet` or `.csv`**, named exactly (lowercase):

```
my-project/
├── collars.{parquet,csv}                  (required)
├── survey.{parquet,csv}                   (recommended — needed for 3D)
├── assays.{parquet,csv}                   (optional — drives the colour-by menu)
├── geology.{parquet,csv}                  (optional — categorical colour-by)
├── structure.{parquet,csv}                (optional — structural discs in 3D)
├── surface_samples.{parquet,csv}          (optional — out-of-hole sample points
│                                              consumed by the Analytics view)
└── precomputed_desurveyed.{parquet,csv}   (optional — bypasses live desurvey)
```

Only `collars` is required. If both formats are present for a file the
**Parquet copy wins** (smaller, faster to parse). Missing files are skipped
silently and the affected viewer falls back to a placeholder.

Parquet files written by pyarrow / duckdb / pandas with any of SNAPPY,
GZIP, ZSTD, BROTLI or LZ4 compression are all supported.

The desktop app is permitted to read only from your home directory and the
common user-data roots (Desktop / Documents / Downloads / platform app-data).
Folders on a different volume or under a system path will fail with a clear
error — copy or symlink the project into one of the allowed roots.

### Canonical schema

Column names match `baselode`'s `standardizeColumns` aliases verbatim — the
loader does no remapping. Synonyms (e.g. `lat` for `latitude`, `md` for
`depth`) are accepted because baselode standardises on read.

| File          | Required columns | Common optional columns |
|---------------|------------------|-------------------------|
| `collars`     | `hole_id`, `latitude`, `longitude` | `elevation`, `datasource_hole_id`, `project_id`, `hole_type`, `max_depth` |
| `survey`      | `hole_id`, `depth`, `azimuth`, `dip` | — |
| `assays`      | `hole_id`, `from`, `to` | one or more analyte columns (e.g. `Au_PPM`, `Cu_PCT`) |
| `geology`     | `hole_id`, `from`, `to` | `geology_code`, `geology_description`, plus any other intervaled attributes |
| `structure`   | `hole_id`, `depth`, `dip`, `azimuth` | `alpha`, `beta`, `strike` |
| `surface_samples` | `sample_id`, `surface_sample_type` + either (`latitude`, `longitude`) or (`easting`, `northing`, `crs`) | `elevation`, `datasource_surface_sample_id`, `report_number`, `project_id`, any analyte / metadata columns |
| `precomputed_desurveyed` | `hole_id`, `x`, `y`, `z`, `md` | — (already-projected, scene-frame XYZ) |

`hole_id` is the join key across files — use the same string everywhere.

The viewer projects collar lat/lng to a **local tangent plane** centred on the
collar centroid (meters east/north). For projects spanning <100 km this is
visually indistinguishable from a per-zone UTM; for continental-scale data,
supply a `precomputed_desurveyed` file produced with your own projection.

## Bundled test data

A converted copy of the GSWA Geochemistry sample (CC BY 4.0, see
`test-data/demo-gswa/ATTRIBUTION.md`) lives at:

```
test-data/demo-gswa/
├── collars.{csv,parquet}    4,685 holes
├── survey.{csv,parquet}     158k rows
├── assays.{csv,parquet}     69k rows × 53 analytes
└── geology.{csv,parquet}    5,831 rows
```

Open that folder from the sidebar to load it.

**CSV is a 10-row sample, Parquet is the full dataset.** The loader picks
Parquet first when both are present, so runtime tests see the complete data;
the CSVs are kept around purely so a human can open one in an editor and
sight-check the schema + a few representative rows. The conversion script
preserves this asymmetry on regenerate. To regenerate from a fresh
upstream pull:

```sh
python3 scripts/convert_demo_data.py \
    ../baselode/test/data/gswa \
    ./test-data/demo-gswa
```

(`pip install pandas pyarrow` first.)

## Running

### Prerequisites

- **Node 18+** and **npm**
- **Rust** (for the Tauri backend) — install via [rustup](https://rustup.rs/).
  On Windows you also need the
  [Microsoft C++ Build Tools](https://v2.tauri.app/start/prerequisites/#windows).
- **WebView2** (Windows-only, pre-installed on Windows 11).

### Local web development (no Rust required)

```sh
npm install
npm run dev
```

Opens at <http://127.0.0.1:1420>. The folder picker falls back to a
`<input webkitdirectory>` element, so you can still test the data-load flow
without the desktop binary.

### Desktop development

```sh
npm install
npm run tauri:dev
```

Launches Vite, builds the Rust binary, and opens the Tauri window.

### Build a Windows installer

```sh
npm run tauri:build
```

Outputs `.msi` and `.exe` (NSIS) installers under
`src-tauri/target/release/bundle/`. Cross-building Windows artefacts from
macOS/Linux requires `cargo-xwin` and the Windows SDK; see the Tauri docs.

## Releasing

Releases are tag-driven via `.github/workflows/release.yml`.

**Cut a new version** — either of these works:

```sh
# (a) From your machine, push a SemVer tag:
git tag v0.1.5
git push origin v0.1.5

# (b) From the GitHub UI, run the "release" workflow with a version input
# (e.g. 0.1.5) — the workflow tags the repo for you.
```

On either trigger the workflow:

1. Resolves the version, strips the leading `v`, and writes it into
   `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`
   so all three stay in lock-step (Vite reads the JS version into
   `__APP_VERSION__`; Tauri reads the JSON version for the bundle).
2. Builds the matrix:
   - **macOS** — universal `.app` (aarch64 + x86_64)
   - **Windows** — `.msi` and NSIS `.exe`
   - **Linux** — `.deb` and `.AppImage`
3. Attaches every bundle to a **draft** GitHub Release named after the tag.
   Review the assets in the Releases UI and click **Publish** when ready.

Versioning convention: `vMAJOR.MINOR.PATCH`, starting at `v0.1.0`. The
workflow rejects non-SemVer strings.

For local one-off builds the version remains whatever's in `package.json` /
`tauri.conf.json` / `Cargo.toml` on disk — the workflow only edits them
in-runner, never commits the change back to the repo.

## License

GPL-3.0-or-later. See [`LICENSE`](LICENSE).
