-- models/bronze/bronze_tf_profiles.sql
{{ config(materialized='table') }}

SELECT
    CAST(id AS STRING) AS id,
    CAST(theme AS STRING) AS theme,
    CAST(role AS STRING) AS role,
    CAST(workout_type_options AS STRING) AS workout_type_options,
    CAST(updated_at AS STRING) AS updated_at
FROM parquet.`/Volumes/workspace/trainingflow_bronze/raw_uploads/tf_profiles.parquet`
