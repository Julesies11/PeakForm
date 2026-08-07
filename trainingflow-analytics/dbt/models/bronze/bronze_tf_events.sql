-- models/bronze/bronze_tf_events.sql
{{ config(materialized='table') }}

SELECT
    id,
    user_id,
    TRY_CAST(date AS DATE) AS date,
    title,
    event_type_id,
    priority_id,
    description,
    created_at
FROM read_files('/Volumes/workspace/trainingflow_bronze/raw_uploads/tf_events.parquet', format => 'parquet')
