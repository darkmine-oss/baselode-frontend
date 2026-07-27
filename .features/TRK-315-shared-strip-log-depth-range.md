# TRK-315 — Shared strip-log depth range

## Outcome

Add a Viewer sidebar control that pins every strip-log track to the same
user-entered measured-depth range, alongside the existing `Start at 0` mode.

## Behaviour

- `From` and `To` accept non-negative metres, with `To > From` required.
- Enabling the range applies `[from, to]` to every panel and disables the
  collar-zero alignment mode.
- Editing either value updates every enabled panel immediately.
- Disabling the range restores automatic per-track depth ranges.

## Dependency

The Viewer passes `config.depthRange` to Baselode `TracePlot`; the shared
renderer pins its inverted Plotly depth axis for every supported plot type.

## Verification

- Viewer `npm run build` passes.
- Baselode full test suite and production build pass.
