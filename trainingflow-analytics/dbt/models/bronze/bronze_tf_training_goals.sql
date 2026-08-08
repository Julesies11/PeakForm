-- models/bronze/bronze_tf_training_goals.sql
{{ config(materialized='table') }}

SELECT
    CAST(id AS STRING) AS id,
    CAST(user_id AS STRING) AS user_id,
    CAST(sport_type_id AS STRING) AS sport_type_id,
    CAST(event_id AS STRING) AS event_id,
    metric,
    TRY_CAST(target_value AS DOUBLE) AS target_value,
    period,
    TRY_CAST(start_date AS DATE) AS start_date,
    TRY_CAST(end_date AS DATE) AS end_date,
    created_at
FROM read_files('/Volumes/workspace/trainingflow_bronze/raw_uploads/tf_training_goals.parquet', format => 'parquet')
