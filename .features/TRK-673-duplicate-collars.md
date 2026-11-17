# Resilient duplicate collar import

Collar import retains the first occurrence of a hole ID when subsequent rows
have matching values. Comparison ignores `_collar_id`, `source_table` and
`source_row_index`; those identify source records rather than collar values.
Numeric collar fields compare numerically, and missing/blank values compare
equally. Conflicting values still stop loading with the hole ID and field names.

Successful imports collect a single non-blocking warning in project state,
shown in the sidebar with the retained count, skipped count and affected IDs.
Opening another project replaces warnings; closing clears them. CSV and Parquet
use the same validation. Input files and rows are never modified.

Verification: `npm test` (40 tests), `npm run build`, and browser import of the
reported Degrussa pack (912 retained collars, three skipped duplicates, no load
errors). The browser warning is shown in `TRK-673-duplicate-warning.png`.
This verifies import and warning behavior, not correctness of all source data.

No dependency changes.
