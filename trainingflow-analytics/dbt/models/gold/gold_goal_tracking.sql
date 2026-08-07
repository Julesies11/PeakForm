-- models/gold/gold_goal_tracking.sql
{{ config(materialized='table') }}

WITH goals AS (
    SELECT * FROM {{ ref('silver_training_goals') }}
),
workouts AS (
    SELECT * FROM {{ ref('silver_workouts') }}
)

SELECT
    g.goal_id,
    g.user_id,
    g.sport_name,
    g.metric,
    g.target_value,
    g.period,
    g.start_date,
    g.end_date,
    g.goal_status,
    COALESCE(
        SUM(
            CASE 
                WHEN g.metric = 'duration' THEN w.actual_duration_minutes
                WHEN g.metric = 'distance' THEN w.actual_distance_km
                ELSE 0 
            END
        ), 0
    ) AS actual_value,
    ROUND(
        COALESCE(
            SUM(
                CASE 
                    WHEN g.metric = 'duration' THEN w.actual_duration_minutes
                    WHEN g.metric = 'distance' THEN w.actual_distance_km
                    ELSE 0 
                END
            ), 0
        ) / NULLIF(g.target_value, 0) * 100, 2
    ) AS progress_percentage
FROM goals g
LEFT JOIN workouts w 
    ON g.user_id = w.user_id 
   AND g.sport_type_id = w.sport_type_id
   AND w.workout_date BETWEEN g.start_date AND g.end_date
GROUP BY 
    g.goal_id, g.user_id, g.sport_name, g.metric, g.target_value, 
    g.period, g.start_date, g.end_date, g.goal_status
ORDER BY g.start_date DESC
