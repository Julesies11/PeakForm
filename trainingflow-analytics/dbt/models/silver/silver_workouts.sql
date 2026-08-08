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
    CAST(w.id AS STRING) AS workout_id,
    CAST(w.user_id AS STRING) AS user_id,
    TRY_CAST(w.date AS DATE) AS workout_date,
    DATE_TRUNC('week', TRY_CAST(w.date AS DATE)) AS week_start_date,
    DATE_TRUNC('month', TRY_CAST(w.date AS DATE)) AS month_start_date,
    CAST(w.title AS STRING) AS workout_title,
    CAST(w.description AS STRING) AS description,
    
    -- Sport & Category details
    CAST(w.sport_type_id AS STRING) AS sport_type_id,
    COALESCE(CAST(s.name AS STRING), 'Unknown') AS sport_name,
    CAST(s.distance_unit AS STRING) AS distance_unit,
    CAST(w.category_id AS STRING) AS category_id,
    COALESCE(CAST(c.name AS STRING), 'Uncategorized') AS category_name,
    
    -- Planned metrics
    COALESCE(TRY_CAST(w.planned_duration_minutes AS INT), 0) AS planned_duration_minutes,
    COALESCE(TRY_CAST(w.planned_distance_km AS DOUBLE), 0.0) AS planned_distance_km,
    
    -- Actual metrics
    COALESCE(TRY_CAST(w.actual_duration_minutes AS INT), 0) AS actual_duration_minutes,
    COALESCE(TRY_CAST(w.actual_distance_km AS DOUBLE), 0.0) AS actual_distance_km,
    COALESCE(TRY_CAST(w.actual_tss AS INT), 0) AS actual_tss,
    
    -- Heart Rate & Power
    TRY_CAST(w.avg_hr AS INT) AS avg_hr,
    TRY_CAST(w.max_hr AS INT) AS max_hr,
    TRY_CAST(w.avg_power AS INT) AS avg_power,
    TRY_CAST(w.max_power AS INT) AS max_power,
    TRY_CAST(w.normalized_power AS INT) AS normalized_power,
    TRY_CAST(w.calories AS INT) AS calories,
    
    -- Flags & Effort
    TRY_CAST(w.effort_level AS INT) AS effort_level,
    CASE TRY_CAST(w.effort_level AS INT)
        WHEN 1 THEN 'Recovery'
        WHEN 2 THEN 'Easy / Steady'
        WHEN 3 THEN 'Tempo / Hard'
        WHEN 4 THEN 'Interval / All Out'
        ELSE 'Unknown'
    END AS effort_label,
    TRY_CAST(w.is_key_workout AS BOOLEAN) AS is_key_workout,
    
    -- Adherence calculation
    CASE 
        WHEN COALESCE(TRY_CAST(w.planned_duration_minutes AS INT), 0) > 0 
        THEN ROUND(COALESCE(TRY_CAST(w.actual_duration_minutes AS INT), 0) / TRY_CAST(w.planned_duration_minutes AS INT), 2)
        ELSE NULL 
    END AS duration_completion_rate,
    
    CASE 
        WHEN COALESCE(TRY_CAST(w.actual_duration_minutes AS INT), 0) > 0 OR COALESCE(TRY_CAST(w.actual_distance_km AS DOUBLE), 0) > 0 
        THEN TRUE ELSE FALSE 
    END AS is_completed,

    CAST(w.created_at AS STRING) AS created_at
FROM workouts w
LEFT JOIN sports s ON CAST(w.sport_type_id AS STRING) = CAST(s.id AS STRING)
LEFT JOIN categories c ON CAST(w.category_id AS STRING) = CAST(c.id AS STRING)
