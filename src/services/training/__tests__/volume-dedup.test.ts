import { describe, expect, it } from 'vitest';
import { Event, Workout } from '@/types/training';
import { getUnfulfilledEventSegments } from '../volume-dedup.utils';

describe('getUnfulfilledEventSegments', () => {
  const runSportId = 'sport-run-123';
  const swimSportId = 'sport-swim-456';
  const bikeSportId = 'sport-bike-789';

  it('returns all segments when NO workouts exist on date', () => {
    const mockEvents: Event[] = [
      {
        id: 'marathon-event',
        date: '2026-09-01',
        eventTypeId: 'et-race',
        eventPriorityId: 'ep-a',
        title: 'City Marathon',
        priority: 'A',
        segments: [
          {
            id: 'seg-run',
            eventId: 'marathon-event',
            sportTypeId: runSportId,
            plannedDurationMinutes: 240,
            plannedDistanceKilometers: 42.2,
            effortLevel: 4,
            segmentOrder: 1,
          },
        ],
      },
    ];

    const unfulfilled = getUnfulfilledEventSegments(mockEvents, []);
    expect(unfulfilled).toHaveLength(1);
    expect(unfulfilled[0].id).toBe('seg-run');
  });

  it('skips event segment when a workout for the SAME sport exists on date (synced event)', () => {
    const mockEvents: Event[] = [
      {
        id: 'marathon-event',
        date: '2026-09-01',
        eventTypeId: 'et-race',
        eventPriorityId: 'ep-a',
        title: 'City Marathon',
        priority: 'A',
        segments: [
          {
            id: 'seg-run',
            eventId: 'marathon-event',
            sportTypeId: runSportId,
            plannedDurationMinutes: 240,
            plannedDistanceKilometers: 42.2,
            effortLevel: 4,
            segmentOrder: 1,
          },
        ],
      },
    ];

    const mockWorkouts: Workout[] = [
      {
        id: 'synced-marathon-workout',
        date: '2026-09-01',
        sportTypeId: runSportId,
        title: 'City Marathon - Run',
        description: 'Imported from Garmin...',
        plannedDurationMinutes: 240,
        plannedDistanceKilometers: 42.2,
        actualDurationMinutes: 238,
        actualDistanceKilometers: 42.15,
        effortLevel: 4,
        isKeyWorkout: true,
        intervals: [],
      },
    ];

    const unfulfilled = getUnfulfilledEventSegments(mockEvents, mockWorkouts);
    // Since a workout for runSportId exists, the run segment is fulfilled and skipped!
    expect(unfulfilled).toHaveLength(0);
  });

  it('handles multi-sport events (Triathlon) with partial workout completion', () => {
    const mockEvents: Event[] = [
      {
        id: 'triathlon-event',
        date: '2026-09-15',
        eventTypeId: 'et-race',
        eventPriorityId: 'ep-a',
        title: 'Olympic Triathlon',
        priority: 'A',
        segments: [
          {
            id: 'tri-swim',
            eventId: 'triathlon-event',
            sportTypeId: swimSportId,
            plannedDurationMinutes: 30,
            plannedDistanceKilometers: 1.5,
            effortLevel: 3,
            segmentOrder: 1,
          },
          {
            id: 'tri-bike',
            eventId: 'triathlon-event',
            sportTypeId: bikeSportId,
            plannedDurationMinutes: 75,
            plannedDistanceKilometers: 40,
            effortLevel: 4,
            segmentOrder: 2,
          },
          {
            id: 'tri-run',
            eventId: 'triathlon-event',
            sportTypeId: runSportId,
            plannedDurationMinutes: 45,
            plannedDistanceKilometers: 10,
            effortLevel: 4,
            segmentOrder: 3,
          },
        ],
      },
    ];

    // Swim and Bike logged, but Run NOT logged yet
    const mockWorkouts: Workout[] = [
      {
        id: 'swim-workout',
        date: '2026-09-15',
        sportTypeId: swimSportId,
        title: 'Triathlon Swim',
        description: '',
        plannedDurationMinutes: 30,
        plannedDistanceKilometers: 1.5,
        effortLevel: 3,
        isKeyWorkout: false,
        intervals: [],
      },
      {
        id: 'bike-workout',
        date: '2026-09-15',
        sportTypeId: bikeSportId,
        title: 'Triathlon Bike',
        description: '',
        plannedDurationMinutes: 75,
        plannedDistanceKilometers: 40,
        effortLevel: 4,
        isKeyWorkout: false,
        intervals: [],
      },
    ];

    const unfulfilled = getUnfulfilledEventSegments(mockEvents, mockWorkouts);
    // Swim & Bike segments are fulfilled, only Run segment remains unfulfilled
    expect(unfulfilled).toHaveLength(1);
    expect(unfulfilled[0].id).toBe('tri-run');
  });
});
