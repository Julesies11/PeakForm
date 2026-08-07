"""
TrainingFlow — Supabase Export Script (Local Parquet Output)
=============================================================
Queries Supabase via the Supavisor pooler and writes each table
as a Parquet file to a local output directory.

Files are then uploaded manually to Databricks Unity Catalog Volumes:
  Databricks → Catalog → trainingflow_bronze schema → raw_uploads volume → Upload

Environment variables (set as GitHub Secrets or local .env):
  SUPABASE_POOLER_URL    — Transaction pooler URI from Supabase Connect button
                           Format: postgresql://postgres.XXXX:PASSWORD@aws-X.pooler.supabase.com:6543/postgres

Output directory: ./parquet_output/
  parquet_output/
    tf_workouts.parquet
    tf_daily_metrics.parquet
    tf_events.parquet
    ... (one file per table)
"""

import os
import io
import sys
import logging
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlparse, unquote

import psycopg2
import pyarrow as pa
import pyarrow.parquet as pq

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SUPABASE_URL = os.environ["SUPABASE_POOLER_URL"]
OUTPUT_DIR   = Path(os.environ.get("OUTPUT_DIR", "parquet_output"))

# Reference / lookup tables — full reload each run
FULL_TABLES = [
    "tf_sport_types",
    "tf_workout_categories",
    "tf_profiles",
    "tf_garmin_sport_mapping",
]

# Core analytical tables
INCREMENTAL_TABLES = [
    "tf_workouts",
    "tf_events",
    "tf_event_segments",
    "tf_training_goals",
    "tf_daily_metrics",
    "tf_notes",
]

ALL_TABLES = FULL_TABLES + INCREMENTAL_TABLES


# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------
def parse_pooler_url(url: str) -> dict:
    """Safely parse pooler URL into psycopg2 kwargs — handles special chars in password."""
    parsed = urlparse(url)
    return {
        "host":            parsed.hostname,
        "port":            parsed.port or 6543,
        "dbname":          parsed.path.lstrip("/") or "postgres",
        "user":            unquote(parsed.username or ""),
        "password":        unquote(parsed.password or ""),
        "connect_timeout": 10,
        "sslmode":         "require",
    }


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
def export_table(conn, table_name: str) -> pa.Table:
    """Query a table and return a PyArrow table."""
    log.info(f"  Querying public.{table_name}...")
    with conn.cursor() as cur:
        cur.execute(f'SELECT * FROM public."{table_name}"')
        rows     = cur.fetchall()
        col_names = [desc[0] for desc in cur.description]

    if not rows:
        log.warning(f"  {table_name}: 0 rows")
        schema = pa.schema([pa.field(col, pa.string()) for col in col_names])
        return pa.table({col: pa.array([], type=pa.string()) for col in col_names}, schema=schema)

    columns: dict = {col: [] for col in col_names}
    for row in rows:
        for col, val in zip(col_names, row):
            columns[col].append(str(val) if isinstance(val, (date, datetime)) else val)

    table = pa.Table.from_pydict(columns)
    log.info(f"  {table_name}: {len(rows):,} rows, {len(col_names)} columns")
    return table


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main() -> None:
    log.info("=== TrainingFlow Supabase → Parquet Export ===")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    log.info(f"Output directory: {OUTPUT_DIR.resolve()}")

    params = parse_pooler_url(SUPABASE_URL)
    log.info(f"Connecting to: {params['host']}:{params['port']}")
    conn = psycopg2.connect(**params)
    conn.set_session(readonly=True, autocommit=True)

    errors = []
    written = []
    for table in ALL_TABLES:
        log.info(f"Processing: {table}")
        try:
            arrow_table  = export_table(conn, table)
            output_path  = OUTPUT_DIR / f"{table}.parquet"
            pq.write_table(arrow_table, output_path, compression="snappy")
            size_kb = output_path.stat().st_size // 1024
            log.info(f"  ✓ Written → {output_path} ({size_kb} KB)")
            written.append(str(output_path))
        except Exception as e:
            log.error(f"  ✗ {table} failed: {e}")
            errors.append((table, str(e)))

    conn.close()

    print()
    log.info("─── Export Summary ───")
    log.info(f"  ✅ {len(written)} files written to {OUTPUT_DIR}/")
    for f in written:
        log.info(f"     {f}")

    if errors:
        log.error(f"\n  ❌ {len(errors)} table(s) failed:")
        for table, msg in errors:
            log.error(f"     {table}: {msg}")
        sys.exit(1)

    print()
    log.info("Next step: Upload the parquet_output/ folder contents to Databricks")
    log.info("  Databricks → Catalog → [your catalog] → trainingflow_bronze schema")
    log.info("  → raw_uploads volume → Upload button → select all .parquet files")


if __name__ == "__main__":
    main()
