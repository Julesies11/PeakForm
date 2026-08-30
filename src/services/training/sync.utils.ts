import { format } from 'date-fns';
import { Event, EventSegment, Workout } from '@/types/training';
import { ProcessedImportRow } from './import.utils';

export interface CandidateTarget {
  targetType: 'WORKOUT' | 'EVENT';
  targetId: string;
  date: string;
  sportTypeId?: string;
  title: string;
  plannedDurationMinutes: number;
  plannedDistanceKilometers: number;
  effortLevel?: number;
  workout?: Workout;
  event?: Event;
  eventSegment?: EventSegment;
}

/**
 * Intelligent Sync & Link Engine
 * Matches incoming Garmin activities to existing calendar workouts and events.
 */
export function applySmartSync(
  incoming: ProcessedImportRow[],
  existingWorkouts: Workout[],
  existingEvents: Event[] = [],
): ProcessedImportRow[] {
  // 1. Group existing workouts by date for efficient lookup
  const existingByDate = new Map<string, Workout[]>();
  existingWorkouts.forEach((w) => {
    const list = existingByDate.get(w.date) || [];
    list.push(w);
    existingByDate.set(w.date, list);
  });

  // Build unified candidate targets by date for Pass 2
  const candidateTargetsByDate = new Map<string, CandidateTarget[]>();

  // Add Workout targets (only placeholders without actual data recorded)
  existingWorkouts.forEach((w) => {
    const isPlaceholder =
      !w.actual_datetime &&
      !(w.actualDurationMinutes || w.actualDistanceKilometers || w.actualTSS);

    if (isPlaceholder) {
      const list = candidateTargetsByDate.get(w.date) || [];
      list.push({
        targetType: 'WORKOUT',
        targetId: w.id,
        date: w.date,
        sportTypeId: w.sportTypeId,
        title: w.title,
        plannedDurationMinutes: w.plannedDurationMinutes || 0,
        plannedDistanceKilometers: w.plannedDistanceKilometers || 0,
        effortLevel: w.effortLevel,
        workout: w,
      });
      candidateTargetsByDate.set(w.date, list);
    }
  });

  // Add Event targets
  existingEvents.forEach((ev) => {
    const list = candidateTargetsByDate.get(ev.date) || [];
    if (ev.segments && ev.segments.length > 0) {
      ev.segments.forEach((seg) => {
        list.push({
          targetType: 'EVENT',
          targetId: `${ev.id}_seg_${seg.id}`,
          date: ev.date,
          sportTypeId: seg.sportTypeId,
          title: seg.sportName ? `${ev.title} (${seg.sportName})` : ev.title,
          plannedDurationMinutes: seg.plannedDurationMinutes || 0,
          plannedDistanceKilometers: seg.plannedDistanceKilometers || 0,
          effortLevel: seg.effortLevel,
          event: ev,
          eventSegment: seg,
        });
      });
    } else {
      list.push({
        targetType: 'EVENT',
        targetId: ev.id,
        date: ev.date,
        sportTypeId: undefined,
        title: ev.title,
        plannedDurationMinutes: 0,
        plannedDistanceKilometers: 0,
        event: ev,
      });
    }
    candidateTargetsByDate.set(ev.date, list);
  });

  // 2. Prepare results array (defaulting to NEW)
  const results: ProcessedImportRow[] = incoming.map((row) => ({
    ...row,
    syncStatus: 'NEW',
  }));

  // 3. Group valid incoming rows by date to process day-by-day
  const incomingByDate = new Map<string, number[]>();
  incoming.forEach((row, index) => {
    if (!row.isValid || !row.workout) return;
    const date = row.workout.date;
    if (!date) return;
    const list = incomingByDate.get(date) || [];
    list.push(index);
    incomingByDate.set(date, list);
  });

  // 4. Process each date independently
  for (const [date, dailyIncomingIndices] of incomingByDate.entries()) {
    const dailyExistingWorkouts = existingByDate.get(date) || [];
    const dailyCandidates = candidateTargetsByDate.get(date) || [];

    const consumedExistingWorkoutIds = new Set<string>();
    const consumedCandidateTargetIds = new Set<string>();
    const consumedIncomingIndices = new Set<number>();

    // Pass 1: Definitive Link (Re-Sync) via actual_datetime on existing workouts
    dailyIncomingIndices.forEach((idx) => {
      const inc = incoming[idx];
      const garminTimestamp = inc.row.actual_datetime;
      if (!garminTimestamp) return;

      const definitiveMatch = dailyExistingWorkouts.find(
        (w) =>
          w.actual_datetime === garminTimestamp &&
          !consumedExistingWorkoutIds.has(w.id),
      );

      if (definitiveMatch) {
        results[idx] = mergeWorkout(inc, definitiveMatch, 'RE-SYNC');
        consumedExistingWorkoutIds.add(definitiveMatch.id);
        consumedCandidateTargetIds.add(definitiveMatch.id);
        consumedIncomingIndices.add(idx);
      }
    });

    // Pass 2: Intelligent Pairing (Sync Fallback) using normalized relative proximity
    const potentialPairs: {
      incIdx: number;
      target: CandidateTarget;
      score: number;
    }[] = [];

    dailyIncomingIndices.forEach((idx) => {
      if (consumedIncomingIndices.has(idx)) return;
      const inc = incoming[idx];

      dailyCandidates.forEach((target) => {
        if (consumedCandidateTargetIds.has(target.targetId)) return;

        // Sport matching: match if target has no specific sportTypeId or sportTypeId matches incoming activity
        const isSportMatch =
          !target.sportTypeId ||
          target.sportTypeId === inc.workout!.sportTypeId;

        if (isSportMatch) {
          const score = calculateProximityScore(inc, target);
          potentialPairs.push({ incIdx: idx, target, score });
        }
      });
    });

    // Sort all potential pairs by score (lower score = closer match)
    potentialPairs.sort((a, b) => a.score - b.score);

    // Pair them up greedily starting from best matches
    potentialPairs.forEach((pair) => {
      if (
        consumedIncomingIndices.has(pair.incIdx) ||
        consumedCandidateTargetIds.has(pair.target.targetId)
      ) {
        return;
      }

      if (pair.target.targetType === 'WORKOUT' && pair.target.workout) {
        results[pair.incIdx] = mergeWorkout(
          incoming[pair.incIdx],
          pair.target.workout,
          'SYNC',
        );
        consumedExistingWorkoutIds.add(pair.target.workout.id);
      } else if (pair.target.targetType === 'EVENT' && pair.target.event) {
        results[pair.incIdx] = mergeEvent(
          incoming[pair.incIdx],
          pair.target.event,
          pair.target.eventSegment,
          'SYNC',
        );
      }

      consumedIncomingIndices.add(pair.incIdx);
      consumedCandidateTargetIds.add(pair.target.targetId);
    });
  }

  return results;
}

/**
 * Calculates proximity score between an incoming Garmin activity and a candidate target.
 * Lower score = closer match. Uses relative percentage error for distance and duration,
 * plus title keyword penalties to penalize matching Warmup/Cooldown activities to main workouts/events.
 */
function calculateProximityScore(
  inc: ProcessedImportRow,
  target: CandidateTarget,
): number {
  const incDur = inc.workout?.plannedDurationMinutes || 0;
  const incDist = inc.workout?.plannedDistanceKilometers || 0;
  const tgtDur = target.plannedDurationMinutes || 0;
  const tgtDist = target.plannedDistanceKilometers || 0;

  const hasDist = tgtDist > 0 && incDist > 0;
  const hasDur = tgtDur > 0 && incDur > 0;

  let score = 0;

  if (hasDist && hasDur) {
    const distRelErr = Math.abs(incDist - tgtDist) / tgtDist;
    const durRelErr = Math.abs(incDur - tgtDur) / tgtDur;
    score = distRelErr * 100 + durRelErr * 100;
  } else if (hasDist) {
    const distRelErr = Math.abs(incDist - tgtDist) / tgtDist;
    score = distRelErr * 100;
  } else if (hasDur) {
    const durRelErr = Math.abs(incDur - tgtDur) / tgtDur;
    score = durRelErr * 100;
  } else {
    // Fallback when target specifies no distance or duration
    score = 500;
  }

  // Title keyword disambiguation for Warmup / Cooldown / Shakeout
  const incTitleLower = (
    inc.row.title ||
    inc.workout?.title ||
    ''
  ).toLowerCase();
  const tgtTitleLower = target.title.toLowerCase();
  const isAuxiliaryIncoming = /warm-?up|cool-?down|shakeout/.test(
    incTitleLower,
  );
  const isAuxiliaryTarget = /warm-?up|cool-?down|shakeout/.test(tgtTitleLower);

  if (isAuxiliaryIncoming && !isAuxiliaryTarget) {
    // Penalty when incoming is explicitly a warmup/cooldown but target is a main workout/event
    score += 300;
  } else if (!isAuxiliaryIncoming && isAuxiliaryTarget) {
    // Penalty when incoming is a main activity but target is a planned warmup/cooldown
    score += 300;
  } else if (isAuxiliaryIncoming && isAuxiliaryTarget) {
    // Bonus when both incoming and target are auxiliary
    score -= 10;
  }

  // Tie-breaker: minor weight for absolute differences to resolve exact matches
  const durAbsDiff = Math.abs(incDur - tgtDur);
  const distAbsDiff = Math.abs(incDist - tgtDist);
  score += durAbsDiff * 0.01 + distAbsDiff * 0.01;

  return score;
}

/**
 * Merges Garmin data into an existing workout
 */
function mergeWorkout(
  row: ProcessedImportRow,
  existing: Workout,
  status: 'SYNC' | 'RE-SYNC',
): ProcessedImportRow {
  const syncDate = format(new Date(), 'yyyy-MM-dd');
  const syncNote = `Imported from Garmin on ${syncDate}`;

  const baseDescription = (existing.description || '').trim();
  const description = baseDescription.includes(syncNote)
    ? baseDescription
    : baseDescription
      ? `${baseDescription}\n\n${syncNote}`
      : syncNote;

  return {
    ...row,
    syncStatus: status,
    workout: {
      ...row.workout,
      id: existing.id, // CRITICAL: This enables upsert
      description: description,
      // We keep existing effortLevel if it was planned,
      // but update everything else from Garmin
      effortLevel: existing.effortLevel,
      order: existing.order,
      recurrenceId: existing.recurrenceId,
      recurrenceRule: existing.recurrenceRule,
    },
  };
}

/**
 * Merges Garmin data with a planned event / event segment
 */
function mergeEvent(
  row: ProcessedImportRow,
  event: Event,
  segment?: EventSegment,
  status: 'SYNC' | 'RE-SYNC' = 'SYNC',
): ProcessedImportRow {
  const syncDate = format(new Date(), 'yyyy-MM-dd');
  const eventTitle = segment?.sportName
    ? `${event.title} - ${segment.sportName}`
    : event.title;
  const syncNote = `Imported from Garmin on ${syncDate} (Event: ${event.title})`;

  const baseDescription = (row.row.title || '').trim();
  const description = baseDescription
    ? `${baseDescription}\n\n${syncNote}`
    : syncNote;

  return {
    ...row,
    syncStatus: status,
    workout: {
      ...row.workout,
      eventId: event.id,
      eventSegmentId: segment?.id,
      title: eventTitle,
      description: description,
      isKeyWorkout: true,
      effortLevel: segment?.effortLevel ?? row.workout?.effortLevel ?? 1,
    },
  };
}
