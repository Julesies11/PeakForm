-- models/silver/silver_training_goals.sql
{{ config(materialized='table') }}

WITH goals AS (
    SELECT * FROM {{ ref('bronze_tf_training_goals') }}
),
sports AS (
    SELECT * FROM {{ ref('bronze_tf_sport_types') }}
)

SELECT
    g.id AS goal_id,
    g.user_id,
    g.sport_type_id,
    COALESCE(s.name, 'Unknown') AS sport_name,
    g.event_id,
    g.metric,
    g.target_value,
    g.period,
    g.start_date,
    g.end_date,
    CASE 
        WHEN CURRENT_DATE() BETWEEN g.start_date AND g.end_date THEN 'Active'
        WHEN CURRENT_DATE() < g.start_date THEN 'Upcoming'
        ELSE 'Completed'
    END AS goal_status,
    g.created_at
FROM goals g
LEFT JOIN sports s ON g.sport_type_id = s.id
