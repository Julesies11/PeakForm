-- models/bronze/bronze_tf_event_segments.sql
{{ config(materialized='table') }}

SELECT
    id,
    event_id,
    sport_type_id,
    TRY_CAST(planned_duration_minutes AS INT) AS planned_duration_minutes,
    TRY_CAST(planned_distance_kilometers AS DOUBLE) AS planned_distance_kilometers,
    TRY_CAST(effort_level AS INT) AS effort_level,
    TRY_CAST(segment_order AS INT) AS segment_order,
    created_at
FROM read_files('/Volumes/workspace/trainingflow_bronze/raw_uploads/tf_event_segments.parquet', format => 'parquet')
