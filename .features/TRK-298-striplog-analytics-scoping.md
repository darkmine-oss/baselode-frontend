# TRK-298 — Strip-log comparison and scoped Analytics loading

## Scope

- Add a Strip Log control that applies plot 1's selected hole to all active
  panels without changing their property, chart type, project filter, or
  display toggles.
- Keep Analytics drillhole rows empty until the user explicitly loads a collar
  project and/or individual holes.  The selected project and holes form a
  de-duplicated union.
- Surface samples retain their existing source toggle and are unaffected by
  drillhole loading scope.

## Design

- Persist Analytics load scope in `AnalyticsSelectionsContext` so navigating
  away does not unexpectedly reset it.
- Derive the available project/hole metadata from collars.  Filter flattened
  assay rows only after the user selects a project or hole; do not derive an
  all-hole analytics row collection by default.
- Provide sidebar controls and an Analytics empty state that explains the
  required action, plus remove/clear affordances for active scope.

## Verification

- Add pure helpers for panel-hole propagation and analytics scope/filtering so
  their behaviour is directly inspectable/testable.
- Run the production build and manually verify Strip Log and Analytics using a
  multi-project local folder when available.  No repository test runner is
  currently configured.
