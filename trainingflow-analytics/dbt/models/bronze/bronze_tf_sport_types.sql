-- models/bronze/bronze_tf_sport_types.sql
{{ config(materialized='table') }}

SELECT
    CAST(id AS STRING) AS id,
    CAST(name AS STRING) AS name,
    CAST(description AS STRING) AS description,
    TRY_CAST(pace_relevant AS BOOLEAN) AS pace_relevant,
    CAST(pace_unit AS STRING) AS pace_unit,
    CAST(distance_unit AS STRING) AS distance_unit,
    CAST(effort1_label AS STRING) AS effort1_label, CAST(effort1_hex AS STRING) AS effort1_hex,
    CAST(effort2_label AS STRING) AS effort2_label, CAST(effort2_hex AS STRING) AS effort2_hex,
    CAST(effort3_label AS STRING) AS effort3_label, CAST(effort3_hex AS STRING) AS effort3_hex,
    CAST(effort4_label AS STRING) AS effort4_label, CAST(effort4_hex AS STRING) AS effort4_hex,
    CAST(created_at AS STRING) AS created_at
FROM parquet.`/Volumes/workspace/trainingflow_bronze/raw_uploads/tf_sport_types.parquet`
