# GSWA Geochem sample — attribution

These files were converted from the GSWA Geochemistry (DMIRS‑047) sample CSVs
shipped with the upstream `baselode` repository. Column names were renamed to
the canonical Baselode Viewer schema; row content is unchanged.

## Source

- Dataset portal (DASC): https://dasc.dmirs.wa.gov.au/home?productAlias=GSWAGeochem
- Data WA catalogue record: https://catalogue.data.wa.gov.au/dataset/gswa-geochemistry
- Date accessed: 2026-02-11

## Licence

Creative Commons Attribution 4.0 International (**CC BY 4.0**) — see
<https://creativecommons.org/licenses/by/4.0/legalcode>.

This licence applies to the data only and does **not** extend GPL‑3.0 terms
from the rest of the repository to these files.

## Required credit lines

© State of Western Australia (Department of Mines, Petroleum and Exploration) 2025

Attribution: Based on Department of Mines, Petroleum and Exploration material.

## Changes made

- Joined collar elevations into collars.
- Renamed columns to the canonical Baselode Viewer schema (e.g. `CompanyHoleId` → `hole_id`, `FromDepth` → `from`).
- Dropped administrative columns (`Id`, `MRTFileId`, `LoadDate`, `ModifiedBy`, etc.) and per-row metadata not needed by the viewer.
- Kept the full assay analyte set.
- Coerced numerics; rows missing a required key (`hole_id` / `from` / `to`) were dropped.
- Re-encoded each file as both `.csv` and `.parquet` (zstd compression).

## No endorsement

Use of these samples does not imply endorsement by the State of Western
Australia or the Department of Mines, Petroleum and Exploration.
