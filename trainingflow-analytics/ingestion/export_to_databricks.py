"""
TrainingFlow — Supabase Export Script
======================================
Queries Supabase via the Supavisor pooler (IPv4-compatible), exports each table
as a Parquet file, and uploads to Databricks Unity Catalog Volumes via the Files REST API
if DATABRICKS_HOST and DATABRICKS_TOKEN are provided. Also saves local copies in OUTPUT_DIR.

Environment variables (set as GitHub Secrets or local env):
  SUPABASE_POOLER_URL    — Transaction pooler URI from Supabase Connect button
  DATABRICKS_HOST        — Base workspace URL, e.g. https://dbc-d33d5a60-72fc.cloud.databricks.com (optional)
  DATABRICKS_TOKEN       — Personal Access Token (optional)
  DATABRICKS_CATALOG     — Unity Catalog catalog name, e.g. "workspace" (default: "workspace")
  OUTPUT_DIR             — Local parquet output path (default: "parquet_output")
"""

import os
import io
import sys
import json
import logging
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlparse, unquote

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
SUPABASE_URL = os.environ["SUPABASE_POOLER_URL"]
OUTPUT_DIR   = Path(os.environ.get("OUTPUT_DIR", "parquet_output"))

DB_HOST      = os.environ.get("DATABRICKS_HOST", "").strip().rstrip("/")
if DB_HOST and not DB_HOST.startswith("http"):
    DB_HOST = "https://" + DB_HOST
DB_TOKEN     = os.environ.get("DATABRICKS_TOKEN", "").strip()
DB_CATALOG   = os.environ.get("DATABRICKS_CATALOG", "workspace").strip()
VOLUME_SCHEMA = "trainingflow_bronze"
VOLUME_NAME   = "raw_uploads"

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
# Helpers
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


def format_val(val):
    """Safely format database values for PyArrow Parquet export."""
    if val is None:
        return None
    if isinstance(val, (dict, list)):
        return json.dumps(val)
    if isinstance(val, (date, datetime)):
        return str(val)
    return val


def export_table(conn, table_name: str) -> pa.Table:
    """Query a table and return a PyArrow table."""
    log.info(f"  Querying public.{table_name}...")
    with conn.cursor() as cur:
        cur.execute(f'SELECT * FROM public."{table_name}"')
        rows      = cur.fetchall()
        col_names = [desc[0] for desc in cur.description]

    if not rows:
        log.warning(f"  {table_name}: 0 rows")
        schema = pa.schema([pa.field(col, pa.string()) for col in col_names])
        return pa.table({col: pa.array([], type=pa.string()) for col in col_names}, schema=schema)

    columns: dict = {col: [] for col in col_names}
    for row in rows:
        for col, val in zip(col_names, row):
            columns[col].append(format_val(val))

    table = pa.Table.from_pydict(columns)
    log.info(f"  {table_name}: {len(rows):,} rows, {len(col_names)} columns")
    return table


def upload_to_databricks(parquet_bytes: bytes, table_name: str) -> None:
    """Upload Parquet bytes to Databricks Unity Catalog Volume via Files REST API."""
    volume_path = f"/Volumes/{DB_CATALOG}/{VOLUME_SCHEMA}/{VOLUME_NAME}/{table_name}.parquet"
    url = f"{DB_HOST}/api/2.0/fs/files{volume_path}?overwrite=true"

    log.info(f"  Uploading to Databricks Volume path {volume_path}...")
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
            f"Upload failed for {table_name}: HTTP {response.status_code} — {response.text}"
        )
    log.info(f"  ✓ Uploaded to Databricks Volume: {table_name}.parquet")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main() -> None:
    log.info("=== TrainingFlow Supabase → Databricks Export ===")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    log.info(f"Output directory: {OUTPUT_DIR.resolve()}")
    
    can_upload_to_db = bool(DB_HOST and DB_TOKEN)
    if can_upload_to_db:
        log.info(f"Databricks Target: {DB_HOST} (Catalog: {DB_CATALOG}, Schema: {VOLUME_SCHEMA}, Volume: {VOLUME_NAME})")
    else:
        log.info("Databricks credentials not fully provided — skipping direct REST API upload.")

    params = parse_pooler_url(SUPABASE_URL)
    log.info(f"Connecting to Supabase: {params['host']}:{params['port']}")
    conn = psycopg2.connect(**params)
    conn.set_session(readonly=True, autocommit=True)

    errors = []
    written = []
    for table in ALL_TABLES:
        log.info(f"Processing: {table}")
        try:
            arrow_table = export_table(conn, table)
            output_path = OUTPUT_DIR / f"{table}.parquet"
            
            # Write bytes to buffer & disk
            buf = io.BytesIO()
            pq.write_table(arrow_table, buf, compression="snappy")
            parquet_bytes = buf.getvalue()

            with open(output_path, "wb") as f:
                f.write(parquet_bytes)

            size_kb = output_path.stat().st_size // 1024
            log.info(f"  ✓ Saved local -> {output_path} ({size_kb} KB)")

            if can_upload_to_db:
                upload_to_databricks(parquet_bytes, table)

            written.append(str(output_path))
        except Exception as e:
            log.error(f"  ✗ {table} failed: {e}")
            errors.append((table, str(e)))

    conn.close()

    print()
    log.info("─── Export Summary ───")
    log.info(f"  ✅ {len(written)} files exported successfully.")

    if errors:
        log.error(f"\n  ❌ {len(errors)} table(s) failed:")
        for table, msg in errors:
            log.error(f"     {table}: {msg}")
        sys.exit(1)


if __name__ == "__main__":
    main()
