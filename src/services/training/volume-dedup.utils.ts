import { Event, EventSegment, Workout } from '@/types/training';

/**
 * Returns event segments for a given date that have NOT been fulfilled by an existing workout
 * for the same sport type. This prevents double-counting volume when an event has been synced
 * to a workout on the calendar.
 */
export function getUnfulfilledEventSegments(
  eventsOnDate: Event[],
  workoutsOnDate: Workout[],
): EventSegment[] {
  const workoutSportTypeIds = new Set(
    workoutsOnDate.map((w) => w.sportTypeId).filter(Boolean),
  );

  const unfulfilledSegments: EventSegment[] = [];

  eventsOnDate.forEach((event) => {
    if (event.segments && event.segments.length > 0) {
      event.segments.forEach((seg) => {
        // If no workout exists for this sport on this date, the segment is unfulfilled
        if (!seg.sportTypeId || !workoutSportTypeIds.has(seg.sportTypeId)) {
          unfulfilledSegments.push(seg);
        }
      });
    }
  });

  return unfulfilledSegments;
}
