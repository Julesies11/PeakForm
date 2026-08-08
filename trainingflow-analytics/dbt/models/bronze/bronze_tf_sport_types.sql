-- models/bronze/bronze_tf_sport_types.sql
{{ config(materialized='table') }}

SELECT
    CAST(id AS STRING) AS id,
    name,
    description,
    TRY_CAST(pace_relevant AS BOOLEAN) AS pace_relevant,
    pace_unit,
    distance_unit,
    effort1_label, effort1_hex,
    effort2_label, effort2_hex,
    effort3_label, effort3_hex,
    effort4_label, effort4_hex,
    created_at
FROM read_files('/Volumes/workspace/trainingflow_bronze/raw_uploads/tf_sport_types.parquet', format => 'parquet')
