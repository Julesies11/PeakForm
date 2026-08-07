# TrainingFlow Analytics Pipeline

A free-tier data architecture for TrainingFlow that ingests Supabase workout data into Databricks Delta Lake, transforms it into Bronze, Silver, and Gold tables using dbt, and visualizes athlete insights in Hex.

---

## Architecture Diagram

```
Supabase (PostgreSQL)
       │  (Supavisor pooler on port 6543 — IPv4 compatible)
       ▼
GitHub Actions Workflow (`trainingflow-databricks-export.yml`)
       │  • Runs daily at 02:00 UTC
       │  • Exports 10 tables to Parquet
       │  • Uploads directly to Databricks Volume via Files REST API
       │  • Stores artifact backup
       ▼
Databricks Unity Catalog (`workspace`)
 ├── Bronze:  `trainingflow_bronze` (raw Parquet reads via Volume `raw_uploads`)
 ├── Silver:  `trainingflow_silver` (clean, typed, joined models)
 └── Gold:    `trainingflow_gold`   (analytics & chart-ready aggregates)
       │
       │  (Databricks SQL Warehouse connection)
       ▼
Hex Dashboards (Community / Free Plan)
```

---

## Folder Structure

```
trainingflow-analytics/
├── ingestion/
│   ├── export_to_databricks.py    # Python script: queries Supabase, exports Parquet & uploads to Databricks
│   ├── test_connections.py        # Connection tester for Supabase + Databricks credentials
│   └── requirements.txt            # Python dependencies (psycopg2-binary, pyarrow, requests)
├── dbt/
│   ├── dbt_project.yml             # dbt project definition
│   ├── profiles.yml                 # Databricks target configuration
│   ├── packages.yml                 # dbt-utils package
│   ├── models/
│   │   ├── sources.yml              # Unity Catalog Volume source definitions
│   │   ├── bronze/                  # 8 Bronze models (raw parquet loaders)
│   │   ├── silver/                  # 4 Silver models (joined, derived metrics)
│   │   └── gold/                    # 8 Gold models (Hex chart aggregates)
│   └── tests/
│       └── schema_tests.yml         # Uniqueness & non-null constraints
└── README.md
```

---

## 1. Prerequisites & Setup

### A. Supabase Connection
1. Open your Supabase project dashboard.
2. Click **Connect** in the top navigation bar.
3. Select **Direct** → **Connection pooler** tab (port `6543`, transaction mode).
4. Copy URI: `postgresql://postgres.xxx:PASSWORD@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres`.

### B. Databricks Volume Setup
1. Open Databricks → **Catalog**.
2. Create Schema: `trainingflow_bronze`.
3. Inside `trainingflow_bronze`, Create Volume: `raw_uploads`.
4. Generate Access Token: User Settings → Developer → Access tokens → **Generate new token**.

### C. GitHub Repository Secrets
Add 4 secrets under `Settings → Secrets and variables → Actions`:

| Secret Name | Value Example |
|---|---|
| `SUPABASE_POOLER_URL` | `postgresql://postgres.xxx:pass@aws-1-...pooler.supabase.com:6543/postgres` |
| `DATABRICKS_HOST` | `https://dbc-d33d5a60-72fc.cloud.databricks.com` |
| `DATABRICKS_TOKEN` | `dapi...` |
| `DATABRICKS_CATALOG` | `workspace` |

---

## 2. Ingestion Execution

### Automated Run
GitHub Actions runs automatically at **02:00 UTC** daily.

### Manual Run
Go to GitHub → **Actions** → **TrainingFlow — Export Supabase to Databricks** → **Run workflow**.

---

## 3. Running dbt Transformations

In Databricks (or locally via dbt CLI):

```bash
cd dbt
dbt deps
dbt run
dbt test
```

### Generated Data Models:

#### Bronze Layer (`trainingflow_bronze`)
- `bronze_tf_workouts`
- `bronze_tf_daily_metrics`
- `bronze_tf_events`
- `bronze_tf_event_segments`
- `bronze_tf_training_goals`
- `bronze_tf_sport_types`
- `bronze_tf_workout_categories`
- `bronze_tf_profiles`

#### Silver Layer (`trainingflow_silver`)
- `silver_workouts` (joined sports & categories, effort labels, completion rate)
- `silver_daily_metrics` (TSS, CTL, ATL, TSB & form status classification)
- `silver_events` (countdown, race segments)
- `silver_training_goals` (periodized target status)

#### Gold Layer (`trainingflow_gold`)
- `gold_weekly_volume` (weekly hours, km, TSS per sport)
- `gold_monthly_volume` (monthly totals)
- `gold_training_load_history` (PMC time-series)
- `gold_sport_distribution` (time % mix)
- `gold_effort_distribution` (intensity zone breakdown)
- `gold_completion_rate` (plan adherence %)
- `gold_goal_tracking` (actual vs target goal progress)
- `gold_event_timeline` (upcoming races & countdown)

---

## 4. Hex Dashboard Setup

Connect Hex to your Databricks SQL Warehouse:
1. In Hex → Data Sources → **Add Data Source** → Select **Databricks**.
2. Host: `dbc-d33d5a60-72fc.cloud.databricks.com`
3. HTTP Path: from Databricks SQL Warehouses page.
4. Token: your Databricks access token.

### Proposed Hex Notebooks:
1. **Training Overview**: Weekly Volume (Area chart from `gold_weekly_volume`), Sport Distribution (Donut chart from `gold_sport_distribution`).
2. **Performance Management Chart (PMC)**: CTL / ATL / TSB time series with form status zones from `gold_training_load_history`.
3. **Plan Adherence**: Target vs Actual duration & distance from `gold_completion_rate`.
4. **Goal Tracking**: Goal progress bars and actual vs target trendlines from `gold_goal_tracking`.
5. **Race Calendar**: Upcoming event countdown & target event segments from `gold_event_timeline`.
