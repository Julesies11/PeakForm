-- models/bronze/bronze_tf_workout_categories.sql
{{ config(materialized='table') }}

SELECT
    id,
    name,
    color,
    TRY_CAST(is_system AS BOOLEAN) AS is_system,
    created_at
FROM read_files('/Volumes/workspace/trainingflow_bronze/raw_uploads/tf_workout_categories.parquet', format => 'parquet')
