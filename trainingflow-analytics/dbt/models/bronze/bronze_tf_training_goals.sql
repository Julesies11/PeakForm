-- models/bronze/bronze_tf_training_goals.sql
{{ config(materialized='table') }}

SELECT
    CAST(id AS STRING) AS id,
    CAST(user_id AS STRING) AS user_id,
    CAST(sport_type_id AS STRING) AS sport_type_id,
    CAST(event_id AS STRING) AS event_id,
    CAST(metric AS STRING) AS metric,
    TRY_CAST(target_value AS DOUBLE) AS target_value,
    CAST(period AS STRING) AS period,
    TRY_CAST(start_date AS DATE) AS start_date,
    TRY_CAST(end_date AS DATE) AS end_date,
    CAST(created_at AS STRING) AS created_at
FROM parquet.`/Volumes/workspace/trainingflow_bronze/raw_uploads/tf_training_goals.parquet`
