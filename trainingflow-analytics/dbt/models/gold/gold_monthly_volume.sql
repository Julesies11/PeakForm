-- models/gold/gold_monthly_volume.sql
{{ config(materialized='table') }}

SELECT
    user_id,
    month_start_date,
    sport_name,
    COUNT(workout_id) AS total_workouts,
    SUM(planned_duration_minutes) AS total_planned_duration_min,
    SUM(actual_duration_minutes) AS total_actual_duration_min,
    SUM(planned_distance_km) AS total_planned_distance_km,
    SUM(actual_distance_km) AS total_actual_distance_km,
    SUM(actual_tss) AS total_tss
FROM {{ ref('silver_workouts') }}
GROUP BY user_id, month_start_date, sport_name
ORDER BY month_start_date DESC, sport_name
