-- models/bronze/bronze_tf_profiles.sql
{{ config(materialized='table') }}

SELECT
    id,
    theme,
    role,
    workout_type_options,
    updated_at
FROM read_files('/Volumes/workspace/trainingflow_bronze/raw_uploads/tf_profiles.parquet', format => 'parquet')
