-- models/gold/gold_training_load_history.sql
{{ config(materialized='table') }}

SELECT
    user_id,
    metric_date,
    week_start_date,
    month_start_date,
    daily_tss,
    ctl,
    atl,
    tsb,
    form_status
FROM {{ ref('silver_daily_metrics') }}
ORDER BY metric_date DESC
