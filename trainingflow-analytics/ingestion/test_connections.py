"""
TrainingFlow — Connection Test Script
======================================
Validates that the four GitHub Secrets are correct and both
Supabase (via pooler) and Databricks (via Files REST API) are reachable.

Run via the 'test-connections' GitHub Actions workflow.
"""

import os
import sys
import logging
import requests
import psycopg2
from urllib.parse import urlparse, unquote

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)


def parse_pooler_url(url: str) -> dict:
    """
    Safely parse a PostgreSQL connection URL into keyword args for psycopg2.
    Handles special characters in passwords (e.g. $, &, @) that break
    naive string-split approaches.
    """
    parsed = urlparse(url)
    return {
        "host":     parsed.hostname,
        "port":     parsed.port or 6543,
        "dbname":   parsed.path.lstrip("/") or "postgres",
        "user":     unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "connect_timeout": 10,
        "sslmode":  "require",
    }


def test_supabase(pooler_url: str) -> bool:
    """
    Connect to Supabase via the Supavisor pooler and run a lightweight query.
    Uses individual psycopg2 kwargs (not a raw URL string) to safely handle
    special characters in the password.
    Returns True on success, False on failure.
    """
    log.info("─── Supabase Connection Test ───")

    try:
        params = parse_pooler_url(pooler_url)
        # Log host only — never log password
        log.info(f"  Host: {params['host']}:{params['port']}")
        log.info(f"  User: {params['user']}")
        log.info(f"  DB:   {params['dbname']}")

        conn = psycopg2.connect(**params)
        conn.set_session(readonly=True, autocommit=True)

        with conn.cursor() as cur:
            cur.execute("""
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name LIKE 'tf_%'
                ORDER BY table_name;
            """)
            tables = [row[0] for row in cur.fetchall()]

            cur.execute("SELECT COUNT(*) FROM public.tf_workouts;")
            workout_count = cur.fetchone()[0]

        conn.close()
        log.info(f"  ✅ Connected successfully")
        log.info(f"  Found {len(tables)} tf_ tables: {', '.join(tables)}")
        log.info(f"  tf_workouts row count: {workout_count:,}")
        return True

    except Exception as e:
        log.error(f"  ❌ Supabase connection FAILED: {e}")
        log.error("  → Check: SUPABASE_POOLER_URL must be the Transaction Pooler URI")
        log.error("    from Supabase → Connect button → Direct → Transaction pooler tab")
        log.error("    Format: postgresql://postgres.XXXX:PASSWORD@aws-X-XX.pooler.supabase.com:6543/postgres")
        return False


def normalise_databricks_host(host: str) -> str:
    """Ensure the host has an https:// prefix and no trailing slash."""
    host = host.strip()
    if not host.startswith("http"):
        host = "https://" + host
    return host.rstrip("/")


def test_databricks(host: str, token: str, catalog: str) -> bool:
    """
    Test Databricks connectivity by directly hitting the APIs we actually need:
      1. Files API  — needed to upload Parquet to Unity Catalog Volumes
      2. SQL Warehouses — needed for dbt to run transformations
    Skips /api/2.0/current-user/me which is not available on Databricks Free Edition.
    Returns True if at least the Files API responds (even 404 = volume not yet created).
    """
    log.info("─── Databricks Connection Test ───")
    host = normalise_databricks_host(host)
    log.info(f"  Host prefix: {host[:35]}...")
    log.info(f"  Catalog: {catalog}")

    headers = {"Authorization": f"Bearer {token}"}

    try:
        # ── Test 1: Files API (primary requirement for Parquet upload) ──
        # Path format: /Volumes/<catalog>/<schema>/<volume>/
        # 200 = volume exists and is readable
        # 404 = volume doesn't exist yet — needs to be created in Databricks UI
        # 400 = path format error — proves API + token work, just path issue
        # 401 = bad token, 403 = missing permissions
        files_url = f"{host}/api/2.0/fs/files/Volumes/{catalog}/trainingflow_bronze/raw_uploads"
        log.info(f"  Testing Files API: GET {files_url}")
        r = requests.get(files_url, headers=headers, timeout=15)
        log.info(f"  Files API response: HTTP {r.status_code}")
        if r.text.strip():
            log.info(f"  Body: {r.text[:300]}")

        if r.status_code in (200, 404):
            if r.status_code == 404:
                log.info("  ✅ Files API reachable — volume not found (needs to be created):")
                log.info("     Databricks → Catalog → [your catalog]")
                log.info("     → Create Schema: 'trainingflow_bronze'")
                log.info("     → Inside that schema, Create Volume: 'raw_uploads'")
            else:
                log.info("  ✅ Files API reachable — volume exists and is ready")
        elif r.status_code == 400:
            # 400 = path/volume issue — but API and token ARE working
            log.info("  ✅ Files API IS reachable and token is valid (HTTP 400 = path issue only)")
            log.info("  → The schema or volume may not exist yet. Create them in Databricks:")
            log.info("     Databricks → Catalog → [your catalog]")
            log.info("     → Create Schema: 'trainingflow_bronze'")
            log.info("     → Inside that schema, Create Volume: 'raw_uploads'")
        elif r.status_code == 401:
            log.error("  ❌ HTTP 401 — Token is invalid or expired")
            log.error("  → Regenerate: Databricks workspace → User Settings → Developer → Access Tokens")
            return False
        elif r.status_code == 403:
            log.error("  ❌ HTTP 403 — Token lacks permission to access Volumes")
            log.error(f"  → Ensure your user has WRITE VOLUME privilege on catalog '{catalog}'")
            return False
        else:
            log.error(f"  ❌ Files API returned HTTP {r.status_code}: {r.text[:300]}")
            return False

        # ── Test 2: SQL Warehouses (needed for dbt) ──
        wh_url = f"{host}/api/2.0/sql/warehouses"
        log.info(f"  Testing SQL Warehouses: GET {wh_url}")
        wh_r = requests.get(wh_url, headers=headers, timeout=15)
        log.info(f"  SQL Warehouses response: HTTP {wh_r.status_code}")

        if wh_r.status_code == 200:
            warehouses = wh_r.json().get("warehouses", [])
            if warehouses:
                wh = warehouses[0]
                log.info(f"  ✅ SQL Warehouse found: '{wh['name']}' (state: {wh.get('state', '?')})")
            else:
                log.warning("  ⚠️  No SQL Warehouses found — create one for dbt:")
                log.warning("     Databricks → SQL → SQL Warehouses → Create SQL Warehouse")
        else:
            log.warning(f"  ⚠️  Could not list SQL Warehouses: HTTP {wh_r.status_code}")

        return True

    except requests.exceptions.ConnectionError as e:
        log.error(f"  ❌ Cannot reach Databricks host: {e}")
        log.error("  → Check DATABRICKS_HOST — must be https://dbc-xxx.cloud.databricks.com")
        return False
    except Exception as e:
        log.error(f"  ❌ Databricks test FAILED: {e}")
        return False


def main() -> None:
    log.info("=== TrainingFlow — Connection Tests ===\n")

    pooler_url = os.environ.get("SUPABASE_POOLER_URL", "")
    db_host    = os.environ.get("DATABRICKS_HOST", "")
    db_token   = os.environ.get("DATABRICKS_TOKEN", "")
    db_catalog = os.environ.get("DATABRICKS_CATALOG", "workspace")

    missing = []
    if not pooler_url: missing.append("SUPABASE_POOLER_URL")
    if not db_host:    missing.append("DATABRICKS_HOST")
    if not db_token:   missing.append("DATABRICKS_TOKEN")
    if missing:
        log.error(f"Missing required secrets: {', '.join(missing)}")
        sys.exit(1)

    results = {}
    results["Supabase"]   = test_supabase(pooler_url)
    print()
    results["Databricks"] = test_databricks(db_host, db_token, db_catalog)

    print()
    log.info("─── Summary ───")
    all_passed = True
    for name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        log.info(f"  {name}: {status}")
        if not passed:
            all_passed = False

    if not all_passed:
        log.error("\nOne or more connection tests failed — check the logs above.")
        sys.exit(1)

    log.info("\nAll connection tests passed! Ready to run the full export.")


if __name__ == "__main__":
    main()
