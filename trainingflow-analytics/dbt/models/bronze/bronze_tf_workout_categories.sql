-- models/bronze/bronze_tf_workout_categories.sql
{{ config(materialized='table') }}

SELECT
    CAST(id AS STRING) AS id,
    CAST(name AS STRING) AS name,
    CAST(color AS STRING) AS color,
    TRY_CAST(is_system AS BOOLEAN) AS is_system,
    CAST(created_at AS STRING) AS created_at
FROM parquet.`/Volumes/workspace/trainingflow_bronze/raw_uploads/tf_workout_categories.parquet`
