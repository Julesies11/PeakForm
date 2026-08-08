-- models/bronze/bronze_tf_workouts.sql
{{ config(
    materialized='table',
    pre_hook="DROP TABLE IF EXISTS workspace.trainingflow_bronze.bronze_tf_workouts"
) }}

SELECT
    CAST(id AS STRING) AS id,
    CAST(user_id AS STRING) AS user_id,
    TRY_CAST(date AS DATE) AS date,
    CAST(title AS STRING) AS title,
    CAST(description AS STRING) AS description,
    TRY_CAST(planned_duration_minutes AS INT) AS planned_duration_minutes,
    TRY_CAST(planned_distance_km AS DOUBLE) AS planned_distance_km,
    TRY_CAST(effort_level AS INT) AS effort_level,
    TRY_CAST(is_key_workout AS BOOLEAN) AS is_key_workout,
    TRY_CAST(actual_duration_minutes AS INT) AS actual_duration_minutes,
    TRY_CAST(actual_distance_km AS DOUBLE) AS actual_distance_km,
    TRY_CAST(actual_tss AS INT) AS actual_tss,
    TRY_CAST(avg_hr AS INT) AS avg_hr,
    TRY_CAST(avg_power AS INT) AS avg_power,
    TRY_CAST(max_hr AS INT) AS max_hr,
    TRY_CAST(max_power AS INT) AS max_power,
    TRY_CAST(normalized_power AS INT) AS normalized_power,
    TRY_CAST(calories AS INT) AS calories,
    CAST(sport_type_id AS STRING) AS sport_type_id,
    CAST(category_id AS STRING) AS category_id,
    CAST(created_at AS STRING) AS created_at
FROM parquet.`/Volumes/workspace/trainingflow_bronze/raw_uploads/tf_workouts.parquet`
