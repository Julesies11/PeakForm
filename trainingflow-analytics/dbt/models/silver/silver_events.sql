-- models/silver/silver_events.sql
{{ config(materialized='table') }}

WITH events AS (
    SELECT * FROM {{ ref('bronze_tf_events') }}
),
segments AS (
    SELECT * FROM {{ ref('bronze_tf_event_segments') }}
),
sports AS (
    SELECT * FROM {{ ref('bronze_tf_sport_types') }}
)

SELECT
    e.id AS event_id,
    e.user_id,
    e.date AS event_date,
    e.title AS event_title,
    e.description AS event_description,
    es.id AS segment_id,
    es.sport_type_id,
    COALESCE(s.name, 'Unknown') AS sport_name,
    es.planned_duration_minutes,
    es.planned_distance_kilometers,
    es.effort_level,
    es.segment_order,
    DATEDIFF(e.date, CURRENT_DATE()) AS days_until_event,
    CASE 
        WHEN e.date < CURRENT_DATE() THEN 'Past'
        WHEN e.date = CURRENT_DATE() THEN 'Today'
        ELSE 'Upcoming'
    END AS event_status,
    e.created_at
FROM events e
LEFT JOIN segments es ON e.id = es.event_id
LEFT JOIN sports s ON es.sport_type_id = s.id
