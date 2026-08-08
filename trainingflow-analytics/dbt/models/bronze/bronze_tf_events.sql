-- models/bronze/bronze_tf_events.sql
{{ config(materialized='table') }}

SELECT
    CAST(id AS STRING) AS id,
    CAST(user_id AS STRING) AS user_id,
    TRY_CAST(date AS DATE) AS date,
    title,
    CAST(event_type_id AS STRING) AS event_type_id,
    CAST(priority_id AS STRING) AS priority_id,
    description,
    created_at
FROM read_files('/Volumes/workspace/trainingflow_bronze/raw_uploads/tf_events.parquet', format => 'parquet')
