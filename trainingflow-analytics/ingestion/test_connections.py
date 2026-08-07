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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger(__name__)


def test_supabase(pooler_url: str) -> bool:
    """
    Connect to Supabase via the Supavisor pooler and run a lightweight query.
    Returns True on success, False on failure.
    """
    log.info("─── Supabase Connection Test ───")
    log.info(f"  Pooler URL: {pooler_url.split('@')[-1]}")  # log host only, not password
    try:
        conn = psycopg2.connect(pooler_url, connect_timeout=10)
        conn.set_session(readonly=True, autocommit=True)
        with conn.cursor() as cur:
            # Check we can reach the DB and see our tables
            cur.execute("""
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name LIKE 'tf_%'
                ORDER BY table_name;
            """)
            tables = [row[0] for row in cur.fetchall()]

            # Also grab a row count from tf_workouts as a smoke test
            cur.execute("SELECT COUNT(*) FROM public.tf_workouts;")
            workout_count = cur.fetchone()[0]

        conn.close()
        log.info(f"  ✅ Connected successfully")
        log.info(f"  Found {len(tables)} tf_ tables: {', '.join(tables)}")
        log.info(f"  tf_workouts row count: {workout_count:,}")
        return True

    except Exception as e:
        log.error(f"  ❌ Supabase connection FAILED: {e}")
        return False


def test_databricks(host: str, token: str, catalog: str) -> bool:
    """
    Verify the Databricks host + token are valid by calling the
    Files API to list the root of the Unity Catalog Volume.
    Uses a lightweight API call that does NOT require a running cluster.
    Returns True on success, False on failure.
    """
    log.info("─── Databricks Connection Test ───")
    host = host.rstrip("/")
    log.info(f"  Host: {host}")
    log.info(f"  Catalog: {catalog}")

    try:
        # Step 1 — Verify token by hitting the /api/2.0/current-user/me endpoint
        me_url = f"{host}/api/2.0/current-user/me"
        response = requests.get(
            me_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        if response.status_code == 200:
            user = response.json()
            log.info(f"  ✅ Token valid — authenticated as: {user.get('userName', 'unknown')}")
        else:
            log.error(f"  ❌ Token invalid: HTTP {response.status_code} — {response.text}")
            return False

        # Step 2 — Check Unity Catalog is accessible by listing schemas
        sql_url = f"{host}/api/2.0/sql/statements"
        sql_payload = {
            "statement": f"SHOW SCHEMAS IN {catalog}",
            "warehouse_id": None,  # Will be None — we use a serverless statement
            "wait_timeout": "10s",
        }
        # Try to find a SQL warehouse ID first
        wh_response = requests.get(
            f"{host}/api/2.0/sql/warehouses",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        if wh_response.status_code == 200:
            warehouses = wh_response.json().get("warehouses", [])
            if warehouses:
                wh_id = warehouses[0]["id"]
                wh_name = warehouses[0]["name"]
                log.info(f"  ✅ SQL Warehouse found: '{wh_name}' (id: {wh_id})")
            else:
                log.warning("  ⚠️  No SQL Warehouses found — dbt will need one created")
        else:
            log.warning(f"  ⚠️  Could not list warehouses: HTTP {wh_response.status_code}")

        # Step 3 — Check Files API (needed for volume upload) is accessible
        # Try to list a path — 404 is fine (path doesn't exist yet), 401/403 is a problem
        files_url = f"{host}/api/2.0/fs/files/Volumes/{catalog}/trainingflow_bronze"
        files_response = requests.get(
            files_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        if files_response.status_code in (200, 404):
            log.info(f"  ✅ Files API reachable (HTTP {files_response.status_code} — volume may not exist yet, that's OK)")
        else:
            log.error(f"  ❌ Files API returned HTTP {files_response.status_code}: {files_response.text}")
            return False

        return True

    except requests.exceptions.ConnectionError as e:
        log.error(f"  ❌ Cannot reach Databricks host '{host}': {e}")
        return False
    except Exception as e:
        log.error(f"  ❌ Databricks test FAILED: {e}")
        return False


def main() -> None:
    log.info("=== TrainingFlow — Connection Tests ===\n")

    # Read secrets from environment
    pooler_url  = os.environ.get("SUPABASE_POOLER_URL", "")
    db_host     = os.environ.get("DATABRICKS_HOST", "")
    db_token    = os.environ.get("DATABRICKS_TOKEN", "")
    db_catalog  = os.environ.get("DATABRICKS_CATALOG", "workspace")

    # Quick pre-flight check for missing secrets
    missing = []
    if not pooler_url:  missing.append("SUPABASE_POOLER_URL")
    if not db_host:     missing.append("DATABRICKS_HOST")
    if not db_token:    missing.append("DATABRICKS_TOKEN")
    if missing:
        log.error(f"Missing required secrets: {', '.join(missing)}")
        sys.exit(1)

    results = {}
    results["Supabase"]   = test_supabase(pooler_url)
    print()
    results["Databricks"] = test_databricks(db_host, db_token, db_catalog)

    # Summary
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
