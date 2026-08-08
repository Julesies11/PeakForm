-- models/silver/silver_workouts.sql
{{ config(materialized='table') }}

WITH workouts AS (
    SELECT * FROM {{ ref('bronze_tf_workouts') }}
),
sports AS (
    SELECT * FROM {{ ref('bronze_tf_sport_types') }}
),
categories AS (
    SELECT * FROM {{ ref('bronze_tf_workout_categories') }}
)

SELECT
    w.id AS workout_id,
    w.user_id,
    w.date AS workout_date,
    DATE_TRUNC('week', w.date) AS week_start_date,
    DATE_TRUNC('month', w.date) AS month_start_date,
    w.title AS workout_title,
    w.description,
    
    -- Sport & Category details
    w.sport_type_id,
    COALESCE(s.name, 'Unknown') AS sport_name,
    s.distance_unit,
    w.category_id,
    COALESCE(c.name, 'Uncategorized') AS category_name,
    
    -- Planned metrics
    COALESCE(w.planned_duration_minutes, 0) AS planned_duration_minutes,
    COALESCE(w.planned_distance_km, 0.0) AS planned_distance_km,
    
    -- Actual metrics
    COALESCE(w.actual_duration_minutes, 0) AS actual_duration_minutes,
    COALESCE(w.actual_distance_km, 0.0) AS actual_distance_km,
    COALESCE(w.actual_tss, 0) AS actual_tss,
    
    -- Heart Rate & Power
    w.avg_hr,
    w.max_hr,
    w.avg_power,
    w.max_power,
    w.normalized_power,
    w.calories,
    
    -- Flags & Effort
    w.effort_level,
    CASE w.effort_level
        WHEN 1 THEN 'Recovery'
        WHEN 2 THEN 'Easy / Steady'
        WHEN 3 THEN 'Tempo / Hard'
        WHEN 4 THEN 'Interval / All Out'
        ELSE 'Unknown'
    END AS effort_label,
    w.is_key_workout,
    
    -- Adherence calculation
    CASE 
        WHEN COALESCE(w.planned_duration_minutes, 0) > 0 
        THEN ROUND(w.actual_duration_minutes / w.planned_duration_minutes, 2)
        ELSE NULL 
    END AS duration_completion_rate,
    
    CASE 
        WHEN COALESCE(w.actual_duration_minutes, 0) > 0 OR COALESCE(w.actual_distance_km, 0) > 0 
        THEN TRUE ELSE FALSE 
    END AS is_completed,

    w.created_at
FROM workouts w
LEFT JOIN sports s ON CAST(w.sport_type_id AS STRING) = CAST(s.id AS STRING)
LEFT JOIN categories c ON CAST(w.category_id AS STRING) = CAST(c.id AS STRING)
