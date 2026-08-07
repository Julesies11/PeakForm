-- models/gold/gold_effort_distribution.sql
{{ config(materialized='table') }}

WITH monthly_totals AS (
    SELECT
        user_id,
        month_start_date,
        SUM(actual_duration_minutes) AS total_month_minutes
    FROM {{ ref('silver_workouts') }}
    GROUP BY user_id, month_start_date
)

SELECT
    w.user_id,
    w.month_start_date,
    w.effort_level,
    w.effort_label,
    SUM(w.actual_duration_minutes) AS effort_duration_minutes,
    mt.total_month_minutes,
    ROUND((SUM(w.actual_duration_minutes) / NULLIF(mt.total_month_minutes, 0)) * 100, 2) AS percentage_of_total_time
FROM {{ ref('silver_workouts') }} w
JOIN monthly_totals mt ON w.user_id = mt.user_id AND w.month_start_date = mt.month_start_date
GROUP BY w.user_id, w.month_start_date, w.effort_level, w.effort_label, mt.total_month_minutes
ORDER BY w.month_start_date DESC, w.effort_level ASC
