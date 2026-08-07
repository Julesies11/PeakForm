-- models/gold/gold_completion_rate.sql
{{ config(materialized='table') }}

SELECT
    user_id,
    week_start_date,
    sport_name,
    COUNT(workout_id) AS total_workouts,
    SUM(CASE WHEN is_completed THEN 1 ELSE 0 END) AS completed_workouts,
    ROUND(SUM(CASE WHEN is_completed THEN 1 ELSE 0 END) / COUNT(workout_id) * 100, 2) AS workout_completion_pct,
    SUM(planned_duration_minutes) AS total_planned_min,
    SUM(actual_duration_minutes) AS total_actual_min,
    ROUND(SUM(actual_duration_minutes) / NULLIF(SUM(planned_duration_minutes), 0) * 100, 2) AS duration_adherence_pct,
    SUM(planned_distance_km) AS total_planned_km,
    SUM(actual_distance_km) AS total_actual_km,
    ROUND(SUM(actual_distance_km) / NULLIF(SUM(planned_distance_km), 0) * 100, 2) AS distance_adherence_pct
FROM {{ ref('silver_workouts') }}
GROUP BY user_id, week_start_date, sport_name
ORDER BY week_start_date DESC, sport_name
