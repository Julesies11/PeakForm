"""
TrainingFlow — Supabase Export Script
======================================
Queries Supabase via the Supavisor pooler (IPv4-compatible, works on free plan),
exports each table as a Parquet file, then uploads to a Databricks Unity Catalog
Volume using the Databricks Files REST API.

This script is designed to run inside a GitHub Actions Ubuntu runner.
No Databricks cluster is required — the Files API is a REST endpoint.

Environment variables (set as GitHub Secrets):
  SUPABASE_POOLER_URL    — Connection pooler URI from Supabase.
                           HOW TO FIND IT:
                             1. Open your Supabase project dashboard
                             2. Click the "Connect" button in the TOP navigation bar
                             3. Select the "Connection pooler" tab (NOT "Direct connection")
                             4. Copy the URI — replace [YOUR-PASSWORD] with your DB password
                           OR: Settings → Configuration → Infrastructure → Connection pooling
                           Format: postgresql://postgres.xxxx:password@aws-0-xx.pooler.supabase.com:6543/postgres

  DATABRICKS_HOST        — e.g. https://adb-xxxxxxxxxxxx.xx.azuredatabricks.net
  DATABRICKS_TOKEN       — Databricks Personal Access Token
  DATABRICKS_CATALOG     — Unity Catalog catalog name, e.g. "workspace"
"""

import os
import io
import sys
import logging
from datetime import date, datetime
from typing import Optional

import psycopg2
import pyarrow as pa
import pyarrow.parquet as pq
import requests

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
SUPABASE_URL   = os.environ["SUPABASE_POOLER_URL"]
DB_HOST        = os.environ["DATABRICKS_HOST"].rstrip("/")
DB_TOKEN       = os.environ["DATABRICKS_TOKEN"]
DB_CATALOG     = os.environ.get("DATABRICKS_CATALOG", "workspace")
VOLUME_SCHEMA  = "trainingflow_bronze"
VOLUME_NAME    = "raw_uploads"

# Databricks Unity Catalog Volume base path
# Format: /Volumes/<catalog>/<schema>/<volume>/
VOLUME_BASE    = f"/Volumes/{DB_CATALOG}/{VOLUME_SCHEMA}/{VOLUME_NAME}"

# ---------------------------------------------------------------------------
# Table configurations
# ---------------------------------------------------------------------------
# Tables exported in full each run (small reference tables)
FULL_TABLES = [
    "tf_sport_types",
    "tf_workout_categories",
    "tf_profiles",
    "tf_garmin_sport_mapping",
]

# Append/incremental tables — export all rows (Databricks dbt handles dedup)
# For personal single-user data these are small enough for a full export daily
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
# Supabase export
# ---------------------------------------------------------------------------
def export_table_to_parquet(conn, table_name: str) -> bytes:
    """Query a table and return its contents as in-memory Parquet bytes."""
    log.info(f"  Querying public.{table_name}...")
    with conn.cursor() as cur:
        cur.execute(f'SELECT * FROM public."{table_name}"')
        rows = cur.fetchall()
        col_names = [desc[0] for desc in cur.description]

    if not rows:
        log.warning(f"  {table_name}: 0 rows — writing empty Parquet file")
        # Write an empty file with schema only
        schema = pa.schema([pa.field(col, pa.string()) for col in col_names])
        table = pa.table({col: pa.array([], type=pa.string()) for col in col_names})
    else:
        # Build a dict of columns → lists (pyarrow handles type inference)
        columns: dict = {col: [] for col in col_names}
        for row in rows:
            for col, val in zip(col_names, row):
                # Coerce non-JSON-serialisable types to strings for safety
                if isinstance(val, (date, datetime)):
                    columns[col].append(str(val))
                else:
                    columns[col].append(val)
        table = pa.Table.from_pydict(columns)

    log.info(f"  {table_name}: {len(rows):,} rows, {len(col_names)} columns")

    buf = io.BytesIO()
    pq.write_table(table, buf, compression="snappy")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Databricks Volume upload
# ---------------------------------------------------------------------------
def upload_to_volume(parquet_bytes: bytes, table_name: str) -> None:
    """Upload Parquet bytes to a Databricks Unity Catalog Volume via Files API."""
    # Partition by date for incremental awareness in dbt
    today = date.today().isoformat()
    volume_path = f"{VOLUME_BASE}/{table_name}/export_date={today}/{table_name}.parquet"
    url = f"{DB_HOST}/api/2.0/fs/files{volume_path}"

    log.info(f"  Uploading to {volume_path} ({len(parquet_bytes):,} bytes)...")
    response = requests.put(
        url,
        headers={
            "Authorization": f"Bearer {DB_TOKEN}",
            "Content-Type": "application/octet-stream",
        },
        data=parquet_bytes,
        timeout=120,
    )

    if response.status_code not in (200, 201, 204):
        raise RuntimeError(
            f"Upload failed for {table_name}: "
            f"HTTP {response.status_code} — {response.text}"
        )
    log.info(f"  ✓ {table_name} uploaded successfully")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main() -> None:
    log.info("=== TrainingFlow Supabase → Databricks Export ===")
    log.info(f"Target volume: {VOLUME_BASE}")

    # Connect to Supabase via pooler (IPv4-compatible on free plan)
    log.info("Connecting to Supabase via Supavisor pooler...")
    conn = psycopg2.connect(SUPABASE_URL)
    conn.set_session(readonly=True, autocommit=True)

    errors = []
    for table in ALL_TABLES:
        log.info(f"Processing: {table}")
        try:
            parquet_bytes = export_table_to_parquet(conn, table)
            upload_to_volume(parquet_bytes, table)
        except Exception as e:
            log.error(f"  ✗ {table} failed: {e}")
            errors.append((table, str(e)))

    conn.close()

    if errors:
        log.error(f"\n{len(errors)} table(s) failed:")
        for table, msg in errors:
            log.error(f"  - {table}: {msg}")
        sys.exit(1)

    log.info(f"\n✅ Export complete — {len(ALL_TABLES)} tables ingested")


if __name__ == "__main__":
    main()
