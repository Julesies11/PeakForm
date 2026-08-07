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
    Verify the Databricks host + token are valid.
    Returns True on success, False on failure.
    """
    log.info("─── Databricks Connection Test ───")
    host = normalise_databricks_host(host)
    # Don't log the full host since GitHub masks it — log a truncated version
    log.info(f"  Host prefix: {host[:30]}...")
    log.info(f"  Catalog: {catalog}")

    headers = {"Authorization": f"Bearer {token}"}

    try:
        # ── Step 1: Validate token via /api/2.0/current-user/me ──
        me_url = f"{host}/api/2.0/current-user/me"
        r = requests.get(me_url, headers=headers, timeout=15)

        if r.status_code == 200:
            user = r.json()
            log.info(f"  ✅ Token valid — user: {user.get('userName', 'unknown')}")
        elif r.status_code == 404:
            log.error(f"  ❌ HTTP 404 on {me_url}")
            log.error("  → DATABRICKS_HOST is likely wrong. It must be your full workspace URL.")
            log.error("    Find it in Databricks: click your username top-right → Copy link")
            log.error("    Format: https://adb-XXXXXXXXXXXXXXXX.XX.azuredatabricks.net")
            log.error(f"    (Do NOT include /sql/1.0/... or any path — just the base URL)")
            return False
        elif r.status_code == 401:
            log.error(f"  ❌ HTTP 401 — Token is invalid or expired")
            log.error("  → Regenerate token: Databricks → User Settings → Developer → Access Tokens")
            return False
        else:
            log.error(f"  ❌ Unexpected HTTP {r.status_code}: {r.text[:200]}")
            return False

        # ── Step 2: List SQL Warehouses ──
        wh_r = requests.get(f"{host}/api/2.0/sql/warehouses", headers=headers, timeout=15)
        if wh_r.status_code == 200:
            warehouses = wh_r.json().get("warehouses", [])
            if warehouses:
                wh_id   = warehouses[0]["id"]
                wh_name = warehouses[0]["name"]
                wh_state = warehouses[0].get("state", "unknown")
                log.info(f"  ✅ SQL Warehouse: '{wh_name}' (id: {wh_id}, state: {wh_state})")
            else:
                log.warning("  ⚠️  No SQL Warehouses found")
                log.warning("  → dbt needs a SQL Warehouse. Create one in Databricks → SQL → SQL Warehouses")
        else:
            log.warning(f"  ⚠️  Could not list warehouses: HTTP {wh_r.status_code}")

        # ── Step 3: Probe Files API ──
        files_url = f"{host}/api/2.0/fs/files/Volumes/{catalog}/trainingflow_bronze"
        files_r = requests.get(files_url, headers=headers, timeout=15)
        if files_r.status_code in (200, 404):
            log.info(f"  ✅ Files API reachable (HTTP {files_r.status_code} — volume may not exist yet, that's fine)")
        elif files_r.status_code == 403:
            log.error(f"  ❌ Files API returned 403 Forbidden")
            log.error(f"  → Token may lack WRITE VOLUME privilege on catalog '{catalog}'")
            return False
        else:
            log.warning(f"  ⚠️  Files API: HTTP {files_r.status_code} — {files_r.text[:200]}")

        return True

    except requests.exceptions.ConnectionError as e:
        log.error(f"  ❌ Cannot reach host: {e}")
        log.error("  → Confirm DATABRICKS_HOST is correct and reachable from GitHub Actions")
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
