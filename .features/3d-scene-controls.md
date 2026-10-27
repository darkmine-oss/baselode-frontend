# 3D scene controls

Status: implemented on feature branches for local review; no merge or release.

- Show a spinner and progress text while preparing survey and precomputed traces. Work starts after a paint opportunity; survey calculations run in batches of 200 holes with a browser yield between batches. Hole controls remain disabled until preparation finishes. Leaving the page or changing projects cancels pending work; errors appear in the sidebar.
- Add all holes below the full-trace picker and below the point-only picker. Each button adds its own group, preserves existing holes and avoids duplicates. The sidebar list uses pages of 100 entries; every added hole remains in the scene.
- The sidebar stays within the window height and scrolls vertically when controls exceed the available space. Sections retain their height and the scene remains independently positioned.
- Select multiple OBJ files in one file dialog. Files load in sequence with progress; invalid files are reported by name without stopping subsequent imports. Project changes cancel pending imports.
- Select an imported mesh by clicking its surface or its sidebar name, then edit its colour. The whole imported group is highlighted. Colour changes remain in memory for the current scene and leave source files and geometry unchanged.
- Hide individual meshes or use Show all meshes / Hide all meshes without unloading. Hidden meshes remain selectable from the sidebar for editing.
- Set opacity from 0–100% and overlay wireframe edges on a selected mesh. All triangle edges are included, with no triangle-count cutoff. Edges follow the surface colour and opacity.
- Toggle the labelled Scene extent box above the viewport. Its bounds and Fit use the loaded holes and visible meshes; hidden or fully transparent meshes are excluded. No camera movement occurs merely from a style change.
- Keep hole labels off initially and skip unused hover picking. Selected-hole details remain in the popup. Dropdown options are memoised so scene selection does not recreate every option.
- Show a visible graphics-context-loss message during a rendering failure. Texture dimensions follow the device limit without dropping holes or reducing colour samples.
- Mesh registration, picking, material isolation, display updates and extent bounds use the Baselode feature branch. The application owns file loading, controls and scene membership.

## Local verification

Use `npm run baselode:local -- /path/to/baselode/javascript/packages/baselode` and `npm run dev`. The helper verifies that `node_modules/baselode` resolves to the chosen checkout. `npm run dev:local` reuses the saved local path and rebuilds the library.

Synthetic checks cover bulk additions, duplicate prevention, point-only holes, invalid files and cancelled imports. Shared-library tests cover nearest-hit selection, hidden and transparent meshes, material isolation, wireframe edges and disposal, click callbacks, transformed bounds and extent-box updates. Viewer tests cover combined hole/mesh bounds and reuse of hole bounds during style edits. The full Baselode suite (832 tests), viewer suite (22 tests), package/type checks and combined production build passed using Node 24.22.1. Loading tests cover progress before computation, all-hole coverage, cancellation, completion without surveys and parse/calculation failures. A comparison using the actual Baselode calculation produced identical coordinates for 405 synthetic holes and 1,620 stations with unchanged inputs. Large-scene checks cover packed colours for 43,000 holes, sample addressing at 1,024 depth samples per hole, filter flags, colour transitions, lazy annotation allocation and equivalent collar picking under transformed parents. A synthetic 43,000-collar benchmark on this computer measured median CPU picking time of 2.51 ms before and 0.14 ms after the change across 15 rays, with identical selected holes. This measures collar picking only; GPU rendering and the reported blackout remain subject to manual review.

Manual checks:

1. Open 3D with a survey project. Confirm the spinner and progress appear, hole controls become available on completion, and navigating away during preparation leaves no pending updates. Add all full traces and all point-only holes; confirm the counts and duplicate prevention.
2. Select several OBJ files, including an invalid file; confirm later valid files still load. Load enough meshes to overflow the sidebar, resize the window and confirm all controls and footer links remain reachable by scrolling.
3. Click two different mesh surfaces and recolour each independently. Select the same meshes from the sidebar.
4. Add or remove holes and change their colour variable; confirm imported meshes remain selectable and retain their colours.
5. Hide/show individual meshes and all meshes, then set opacity to 0%, 50% and 100%. Confirm hidden and fully transparent meshes do not intercept clicks; use the sidebar to restore them.
6. Enable wireframe edges on multiple meshes. Confirm triangles appear over the filled surfaces, follow colour/opacity changes and disappear when disabled or removed.
7. Toggle Scene extent box, then hide/show or remove the outermost mesh. Confirm the extent and Fit follow visible content, retain holes and clear when the scene is empty.
8. Load 43,000 holes, select holes at several zoom levels and change the colour variable. Confirm the scene remains visible, colours remain consistent and selected-hole details appear. Inspect any graphics-context-loss message.
9. Remove a selected mesh, click empty space, press Escape, and switch projects during an import; confirm selection and pending files clear correctly.

## Options for subsequent review

These are proposals based on existing Geo application controls; they are not included in this change.

| Option | Purpose | Existing implementation |
| --- | --- | --- |
| Zoom to selected objects | Fit the camera to a chosen subset | 3D view and object bounds |
| Hole labels and fading unselected holes | Identify holes and retain surrounding context | 3D controls using Baselode annotations and filters |
| Quantile colour classes | Show grade distributions alongside the existing equal-interval classes | Baselode colour API used in the Geo 3D view |
| Polylines, point sets and block models | Add interpretation lines, samples and model cells; filter blocks by attributes | Geo object loaders and block display controls; requires additional viewer input contracts |
