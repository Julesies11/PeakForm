-- models/bronze/bronze_tf_events.sql
{{ config(materialized='table') }}

SELECT
    CAST(id AS STRING) AS id,
    CAST(user_id AS STRING) AS user_id,
    TRY_CAST(date AS DATE) AS date,
    CAST(title AS STRING) AS title,
    CAST(event_type_id AS STRING) AS event_type_id,
    CAST(priority_id AS STRING) AS priority_id,
    CAST(description AS STRING) AS description,
    CAST(created_at AS STRING) AS created_at
FROM parquet.`/Volumes/workspace/trainingflow_bronze/raw_uploads/tf_events.parquet`
