-- models/bronze/bronze_tf_daily_metrics.sql
{{ config(materialized='table') }}

SELECT
    id,
    user_id,
    TRY_CAST(date AS DATE) AS date,
    TRY_CAST(tss AS INT) AS tss,
    TRY_CAST(ctl AS DOUBLE) AS ctl,
    TRY_CAST(atl AS DOUBLE) AS atl,
    TRY_CAST(tsb AS DOUBLE) AS tsb,
    created_at
FROM read_files('/Volumes/workspace/trainingflow_bronze/raw_uploads/tf_daily_metrics.parquet', format => 'parquet')
