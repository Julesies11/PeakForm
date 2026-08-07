-- models/silver/silver_daily_metrics.sql
{{ config(materialized='table') }}

WITH metrics AS (
    SELECT * FROM {{ ref('bronze_tf_daily_metrics') }}
)

SELECT
    id AS metric_id,
    user_id,
    date AS metric_date,
    DATE_TRUNC('week', date) AS week_start_date,
    DATE_TRUNC('month', date) AS month_start_date,
    COALESCE(tss, 0) AS daily_tss,
    COALESCE(ctl, 0.0) AS ctl,  -- Fitness
    COALESCE(atl, 0.0) AS atl,  -- Fatigue
    COALESCE(tsb, 0.0) AS tsb,  -- Form (CTL - ATL)
    
    -- Form status categorization
    CASE
        WHEN tsb < -30 THEN 'High Fatigue / Overreaching'
        WHEN tsb BETWEEN -30 AND -10 THEN 'Productive Training'
        WHEN tsb BETWEEN -10 AND 10 THEN 'Optimal / Fresh'
        WHEN tsb BETWEEN 10 AND 25 THEN 'Taper / Race Ready'
        WHEN tsb > 25 THEN 'Detraining Risk'
        ELSE 'Neutral'
    END AS form_status,

    created_at
FROM metrics
