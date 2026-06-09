"""
Convert the GSWA Geochem sample CSVs from the baselode test-data folder into
the canonical Baselode Viewer schema, emitting both .csv and .parquet for each
of: collars, survey, assays, geology.

Canonical column names match baselode's `standardizeColumns` aliases so the
loader pipeline picks them up with zero remapping.

NOTE: Checkout baselode.git side-by-side to this repo. The example invocation
below assumes the directory layout:

    <parent>/
    ├── baselode/                (https://github.com/darkmine-oss/baselode)
    └── baselode-frontend/       (this repo)

Usage:
    python convert_demo_data.py SRC_DIR DST_DIR

Example:
    python convert_demo_data.py \
        ../../baselode/test/data/gswa \
        ../test-data/demo-gswa
"""

import sys
from pathlib import Path

import pandas as pd

ANALYTE_SUFFIXES = ("_PPM", "_PCT", "_PPB", "_PERCENT")

# Parquet gets the full dataset (the app loads parquet preferentially).
# CSV gets a small head() sample, kept around purely so a human can open it
# in an editor and see the schema + a few representative rows.
CSV_SAMPLE_ROWS = 10


def write_pair(df: pd.DataFrame, out_dir: Path, name: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / f"{name}.csv"
    parquet_path = out_dir / f"{name}.parquet"
    df.head(CSV_SAMPLE_ROWS).to_csv(csv_path, index=False)
    df.to_parquet(parquet_path, index=False, compression="snappy")
    print(
        f"  {name:8s}  rows={len(df):>7d}  cols={len(df.columns):>3d}  "
        f"csv-sample={CSV_SAMPLE_ROWS}  "
        f"parquet={parquet_path.stat().st_size / 1024:.0f} KiB"
    )


def convert_collars(src: Path) -> pd.DataFrame:
    c = pd.read_csv(src / "gswa_sample_collars.csv", low_memory=False)
    return pd.DataFrame(
        {
            "hole_id": c["CompanyHoleId"].astype(str).str.strip(),
            "datasource_hole_id": c["HoleId"].astype(str).str.strip(),
            "latitude": pd.to_numeric(c["Latitude"], errors="coerce"),
            "longitude": pd.to_numeric(c["Longitude"], errors="coerce"),
            "elevation": pd.to_numeric(c["Elevation"], errors="coerce"),
            "hole_type": c.get("HoleType", pd.Series(dtype="object")),
            "max_depth": pd.to_numeric(c.get("MaxDepth"), errors="coerce"),
            "project_id": c.get("Dataset", pd.Series(dtype="object")).fillna("GSWA"),
        }
    ).dropna(subset=["hole_id", "latitude", "longitude"])


def convert_survey(src: Path) -> pd.DataFrame:
    s = pd.read_csv(src / "gswa_sample_survey.csv", low_memory=False)
    return pd.DataFrame(
        {
            "hole_id": s["CompanyHoleId"].astype(str).str.strip(),
            "depth": pd.to_numeric(s["Depth"], errors="coerce"),
            "azimuth": pd.to_numeric(s["Azimuth"], errors="coerce"),
            "dip": pd.to_numeric(s["Dip"], errors="coerce"),
        }
    ).dropna(subset=["hole_id", "depth", "azimuth", "dip"])


def convert_assays(src: Path) -> pd.DataFrame:
    a = pd.read_csv(src / "gswa_sample_assays.csv", low_memory=False)
    analyte_cols = [c for c in a.columns if any(c.endswith(suf) for suf in ANALYTE_SUFFIXES)]
    if not analyte_cols:
        raise SystemExit("No analyte columns (*_PPM, *_PCT, *_PPB) detected in assays source.")
    base = pd.DataFrame(
        {
            "hole_id": a["CompanyHoleId_x"].astype(str).str.strip(),
            "from": pd.to_numeric(a["FromDepth"], errors="coerce"),
            "to": pd.to_numeric(a["ToDepth"], errors="coerce"),
        }
    )
    for col in analyte_cols:
        base[col] = pd.to_numeric(a[col], errors="coerce")
    return base.dropna(subset=["hole_id", "from", "to"])


def convert_geology(src: Path) -> pd.DataFrame:
    g = pd.read_csv(src / "gswa_sample_geology.csv", low_memory=False)
    return pd.DataFrame(
        {
            "hole_id": g["CompanyHoleId"].astype(str).str.strip(),
            "from": pd.to_numeric(g["FromDepth"], errors="coerce"),
            "to": pd.to_numeric(g["ToDepth"], errors="coerce"),
            "geology_code": g.get("Lith1", pd.Series(dtype="object")),
            "geology_description": g.get("GeologyComment", pd.Series(dtype="object")),
            "interpretation": g.get("Interp1", pd.Series(dtype="object")),
            "regolith": g.get("Regol", pd.Series(dtype="object")),
            "weathering": g.get("Weath", pd.Series(dtype="object")),
        }
    ).dropna(subset=["hole_id", "from", "to"])


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src = Path(sys.argv[1]).resolve()
    dst = Path(sys.argv[2]).resolve()
    if not src.exists():
        print(f"Source directory does not exist: {src}")
        return 1

    print(f"src: {src}")
    print(f"dst: {dst}")

    write_pair(convert_collars(src), dst, "collars")
    write_pair(convert_survey(src), dst, "survey")
    write_pair(convert_assays(src), dst, "assays")
    write_pair(convert_geology(src), dst, "geology")
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
