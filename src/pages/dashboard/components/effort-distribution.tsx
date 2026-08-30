import { memo, useMemo } from 'react';
import { parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Event, EventSegment, Workout } from '@/types/training';
import { getUnfulfilledEventSegments } from '@/services/training/volume-dedup.utils';

type ViewType = 'week' | 'month';

const formatMins = (totalMins: number) => {
  const roundedMins = Math.round(totalMins);
  if (roundedMins <= 0) return '0m';
  const h = Math.floor(roundedMins / 60);
  const m = roundedMins % 60;
  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${m}m`;
};

interface EffortDistributionProps {
  workouts: Workout[];
  events: Event[];
  distViewType: ViewType;
  distPivotDate: Date;
  setDistViewType: (type: ViewType) => void;
  onShift: (direction: 'prev' | 'next') => void;
}

export const EffortDistribution = memo(function EffortDistribution({
  workouts,
  events,
  distViewType,
  distPivotDate,
  setDistViewType,
  onShift,
}: EffortDistributionProps) {
  const effortDistribution = useMemo(() => {
    const start = new Date(distPivotDate);
    const end = new Date(distPivotDate);
    if (distViewType === 'week') {
      const day = start.getDay();
      const diff = start.getDate() - (day === 0 ? 6 : day - 1);
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);
      end.setTime(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(start.getMonth() + 1);
    }

    const filteredWorkouts = workouts.filter((w) => {
      const d = parseISO(w.date);
      return d >= start && d < end;
    });

    const filteredEvents = events.filter((e) => {
      const d = parseISO(e.date);
      return d >= start && d < end;
    });

    const workoutsByDate = new Map<string, Workout[]>();
    filteredWorkouts.forEach((w) => {
      const list = workoutsByDate.get(w.date) || [];
      list.push(w);
      workoutsByDate.set(w.date, list);
    });

    const eventsByDate = new Map<string, Event[]>();
    filteredEvents.forEach((e) => {
      const list = eventsByDate.get(e.date) || [];
      list.push(e);
      eventsByDate.set(e.date, list);
    });

    const unfulfilledSegments: EventSegment[] = [];
    eventsByDate.forEach((dayEvents, dateStr) => {
      const dayWorkouts = workoutsByDate.get(dateStr) || [];
      unfulfilledSegments.push(
        ...getUnfulfilledEventSegments(dayEvents, dayWorkouts),
      );
    });

    let totalDuration = filteredWorkouts.reduce((sum, w) => {
      const dur = w.plannedDurationMinutes || 0;
      return sum + dur;
    }, 0);

    unfulfilledSegments.forEach((seg) => {
      totalDuration += seg.plannedDurationMinutes || 0;
    });

    totalDuration = totalDuration || 1;

    const levels = [1, 2, 3, 4];
    return levels
      .map((level) => {
        const levelDuration = filteredWorkouts
          .filter((w) => w.effortLevel === level)
          .reduce((sum, w) => sum + (w.plannedDurationMinutes || 0), 0);

        let eventLevelDuration = 0;
        unfulfilledSegments.forEach((seg) => {
          if (seg.effortLevel === level) {
            eventLevelDuration += seg.plannedDurationMinutes || 0;
          }
        });

        const totalLevelDuration = levelDuration + eventLevelDuration;
        const label =
          level === 1
            ? 'recovery'
            : level === 2
              ? 'endurance'
              : level === 3
                ? 'tempo'
                : 'threshold';

        const color =
          level === 1
            ? '#3b82f6' // Blue
            : level === 2
              ? '#10b981' // Green
              : level === 3
                ? '#f59e0b' // Orange
                : '#ef4444'; // Red

        return {
          level,
          label,
          duration: totalLevelDuration,
          percent: Math.round((totalLevelDuration / totalDuration) * 100),
          color,
        };
      })
      .filter((item) => item.duration > 0);
  }, [workouts, events, distViewType, distPivotDate]);

  const distributionLabel = useMemo(() => {
    if (distViewType === 'week') {
      const start = new Date(distPivotDate);
      const day = start.getDay();
      const diff = start.getDate() - (day === 0 ? 6 : day - 1);
      start.setDate(diff);
      return `wk of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase()}`;
    }
    return distPivotDate
      .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      .toLowerCase();
  }, [distViewType, distPivotDate]);

  return (
    <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
      <div className="border-b bg-muted/30 px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base md:text-lg font-black lowercase tracking-tight">
            effort distribution
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onShift('prev')}
              className="p-1 rounded hover:bg-muted transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => onShift('next')}
              className="p-1 rounded hover:bg-muted transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-bold lowercase text-muted-foreground">
            {distributionLabel}
          </span>
          <div className="flex items-center gap-1 rounded-lg border bg-background p-0.5">
            <button
              onClick={() => setDistViewType('week')}
              className={`px-2 py-1 text-xs font-bold lowercase rounded transition-colors ${
                distViewType === 'week'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              week
            </button>
            <button
              onClick={() => setDistViewType('month')}
              className={`px-2 py-1 text-xs font-bold lowercase rounded transition-colors ${
                distViewType === 'month'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              month
            </button>
          </div>
        </div>
        <div className="space-y-4">
          {effortDistribution.length === 0 ? (
            <div className="h-24 flex items-center justify-center text-muted-foreground text-xs lowercase italic">
              no data for this period
            </div>
          ) : (
            effortDistribution.map((item) => (
              <div key={item.level} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-bold lowercase">{item.label}</span>
                  <span className="text-muted-foreground font-medium">
                    {formatMins(item.duration)} ({item.percent}%)
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${item.percent}%`,
                      backgroundColor: item.color,
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});
