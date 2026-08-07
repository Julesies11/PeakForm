-- models/gold/gold_event_timeline.sql
{{ config(materialized='table') }}

SELECT
    event_id,
    user_id,
    event_date,
    event_title,
    event_description,
    sport_name,
    planned_duration_minutes,
    planned_distance_kilometers,
    effort_level,
    days_until_event,
    event_status
FROM {{ ref('silver_events') }}
ORDER BY event_date ASC, segment_order ASC
