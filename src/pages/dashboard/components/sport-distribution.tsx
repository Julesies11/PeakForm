import { memo, useMemo } from 'react';
import { parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Event,
  EventSegment,
  SportTypeRecord,
  UserSportSettings,
  Workout,
} from '@/types/training';
import { getEffortColor } from '@/services/training/effort-colors';
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

interface SportDistributionProps {
  workouts: Workout[];
  events: Event[];
  sportTypes: SportTypeRecord[];
  userSettingsMap: Map<string, UserSportSettings>;
  distViewType: ViewType;
  distPivotDate: Date;
  setDistViewType: (type: ViewType) => void;
  onShift: (direction: 'prev' | 'next') => void;
}

export const SportDistribution = memo(function SportDistribution({
  workouts,
  events,
  sportTypes,
  userSettingsMap,
  distViewType,
  distPivotDate,
  setDistViewType,
  onShift,
}: SportDistributionProps) {
  const trainingDistribution = useMemo(() => {
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

    return sportTypes
      .map((st) => {
        let sportDuration = filteredWorkouts
          .filter((w) => w.sportName === st.name || w.sportTypeId === st.id)
          .reduce((sum, w) => {
            const dur = w.plannedDurationMinutes || 0;
            return sum + dur;
          }, 0);

        unfulfilledSegments.forEach((seg) => {
          if (seg.sportName === st.name || seg.sportTypeId === st.id) {
            sportDuration += seg.plannedDurationMinutes || 0;
          }
        });

        return {
          sport: st.name,
          duration: sportDuration,
          percent: Math.round((sportDuration / totalDuration) * 100),
          color: getEffortColor(st, 4, userSettingsMap.get(st.id)),
        };
      })
      .filter((item) => item.duration > 0);
  }, [
    workouts,
    events,
    sportTypes,
    userSettingsMap,
    distViewType,
    distPivotDate,
  ]);

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
            sport distribution
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
          {trainingDistribution.map((item) => (
            <div key={item.sport} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-bold lowercase">{item.sport}</span>
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
          ))}
        </div>
      </div>
    </div>
  );
});
