# 3D scene controls

Status: implemented on feature branches for local review; no merge or release.

- Add all holes below the full-trace picker and below the point-only picker. Each button adds its own group, preserves existing holes and avoids duplicates. The sidebar list uses pages of 100 entries; every added hole remains in the scene.
- Select multiple OBJ files in one file dialog. Files load in sequence with progress; invalid files are reported by name without stopping subsequent imports. Project changes cancel pending imports.
- Select an imported mesh by clicking its surface or its sidebar name, then edit its colour. The whole imported group is highlighted. Colour changes remain in memory for the current scene and leave source files and geometry unchanged.
- Mesh registration, picking, material isolation and colour updates use the Baselode feature branch. The application owns file loading, controls and scene membership.

## Local verification

Use `npm run baselode:local -- /path/to/baselode/javascript/packages/baselode` and `npm run dev`. The helper verifies that `node_modules/baselode` resolves to the chosen checkout. `npm run dev:local` reuses the saved local path and rebuilds the library.

Synthetic checks cover bulk additions, duplicate prevention, point-only holes, invalid files and cancelled imports. Shared-library tests cover nearest-hit selection, hidden meshes, material isolation, disposal and click callbacks. The complete shared suite (811 tests), viewer suite (13 tests), package/type checks and combined production build passed on macOS using Node 24.22.1. Interactive review remains manual.

Manual checks:

1. Add all full traces and all point-only holes; confirm the counts and duplicate prevention.
2. Select several OBJ files, including an invalid file; confirm later valid files still load.
3. Click two different mesh surfaces and recolour each independently. Select the same meshes from the sidebar.
4. Add or remove holes and change their colour variable; confirm imported meshes remain selectable and retain their colours.
5. Remove a selected mesh, click empty space, press Escape, and switch projects during an import; confirm selection and pending files clear correctly.

## Options for subsequent review

These are proposals based on existing Geo application controls; they are not included in this change.

| Option | Purpose | Existing implementation |
| --- | --- | --- |
| Mesh visibility, Show all and Hide all | Compare surfaces without unloading files | Object picker and object table |
| Mesh opacity | Inspect holes and contacts behind a surface | Object style controls |
| Wireframe edges | Inspect triangulation and surface contacts | Geometry-object renderer; currently restricted to meshes below 200,000 triangles |
| Zoom to selected objects | Fit the camera to a chosen subset | 3D view and object bounds |
| Hole labels and fading unselected holes | Identify holes and retain surrounding context | 3D controls using Baselode annotations and filters |
| Quantile colour classes | Show grade distributions alongside the existing equal-interval classes | Baselode colour API used in the Geo 3D view |
| Scene extent box | Display spatial limits | Baselode extent-box option used in the Geo 3D view |
| Polylines, point sets and block models | Add interpretation lines, samples and model cells; filter blocks by attributes | Geo object loaders and block display controls; requires additional viewer input contracts |
