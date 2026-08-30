import React from 'react';
import { parseISO } from 'date-fns';
import {
  Event,
  Note,
  SportTypeRecord,
  TrainingGoal,
  UserSportSettings,
  Workout,
} from '@/types/training';
import {
  DAY_HEADERS,
  formatDateToLocalISO,
  formatMinsShort,
} from '@/services/training/calendar.utils';
import { getEffortColor } from '@/services/training/effort-colors';
import {
  isMetersDistance,
  isPaceRelevant,
} from '@/services/training/pace-utils';
import { getSportIcon } from '@/services/training/sport-icons';
import { getUnfulfilledEventSegments } from '@/services/training/volume-dedup.utils';
import { CalendarDay } from './calendar-day';

interface CalendarGridProps {
  weeks: Date[][];
  workouts: Workout[];
  notes: Note[];
  events: Event[];
  goals: TrainingGoal[];
  sportMap: Map<string, SportTypeRecord>;
  userSettingsMap: Map<string, UserSportSettings>;
  selectedDate: string;
  displayMonth: number;
  onSelect: (date: string) => void;
  onDragOver: (e: React.DragEvent, date: string, count: number) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, date: string) => void;
  onDragStart: (e: React.DragEvent, item: Workout | Note) => void;
  onDragEnd: () => void;
  onEventDragStart: (e: React.DragEvent, item: Event) => void;
  onEditWorkout: (w: Workout) => void;
  onEditNote: (n: Note) => void;
  onEditEvent: (e: Event) => void;
  isDraggingId: string | null;
  dragOverInfo: { date: string; index: number } | null;
  todayRef?: React.RefObject<HTMLDivElement | null>;
  hideDates?: boolean;
}

export const CalendarGrid = React.memo(
  ({
    weeks,
    workouts,
    notes,
    events,
    goals,
    sportMap,
    userSettingsMap,
    selectedDate,
    displayMonth,
    onSelect,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragStart,
    onDragEnd,
    onEventDragStart,
    onEditWorkout,
    onEditNote,
    onEditEvent,
    isDraggingId,
    dragOverInfo,
    todayRef,
    hideDates,
  }: CalendarGridProps) => {
    const gridColsClass =
      'grid-cols-7 lg:grid-cols-[repeat(7,minmax(0,1fr))_120px]';

    const calculateWeekSummary = (week: Date[]) => {
      const sportTotals: Record<
        string,
        { distance: number; duration: number }
      > = {};
      const weekTotals = { distance: 0, duration: 0 };
      week.forEach((date) => {
        const dateStr = formatDateToLocalISO(date);

        const dayWorkouts = workouts.filter((w) => w.date === dateStr);
        const dayEvents = events.filter((e) => e.date === dateStr);

        // Add workout totals
        dayWorkouts.forEach((w) => {
          const dur = w.plannedDurationMinutes || 0;
          let dist = w.plannedDistanceKilometers || 0;
          const stId = w.sportTypeId || 'unknown';
          const st = sportMap.get(stId);

          if (st && isMetersDistance(st.distanceUnit)) {
            dist = dist * 1000;
          }

          if (!sportTotals[stId])
            sportTotals[stId] = { distance: 0, duration: 0 };
          sportTotals[stId].duration += dur;
          sportTotals[stId].distance += dist;
          weekTotals.duration += dur;
          if (isPaceRelevant(!!st?.paceRelevant, st?.paceUnit))
            weekTotals.distance += dist;
        });

        // Add unfulfilled event segment totals (skips segments that already have a workout for that sport on date)
        const unfulfilledSegments = getUnfulfilledEventSegments(
          dayEvents,
          dayWorkouts,
        );
        unfulfilledSegments.forEach((seg) => {
          const dur = seg.plannedDurationMinutes || 0;
          let dist = seg.plannedDistanceKilometers || 0;
          const stId = seg.sportTypeId || 'unknown';
          const st = sportMap.get(stId);

          if (st && isMetersDistance(st.distanceUnit, st.name)) {
            dist = dist * 1000;
          }

          if (!sportTotals[stId])
            sportTotals[stId] = { distance: 0, duration: 0 };
          sportTotals[stId].duration += dur;
          sportTotals[stId].distance += dist;
          weekTotals.duration += dur;
          if (isPaceRelevant(!!st?.paceRelevant, st?.paceUnit))
            weekTotals.distance += dist;
        });
      });

      const weekStart = week[0];
      const weekEnd = week[week.length - 1];
      const activeGoals = goals.filter((g) => {
        const gStart = parseISO(g.startDate);
        const gEnd = parseISO(g.endDate);
        return gStart <= weekEnd && gEnd >= weekStart;
      });

      return { sportTotals, weekTotals, activeGoals };
    };

    return (
      <div className="bg-card relative flex flex-1 flex-col rounded-2xl border shadow-sm">
        {/* Day headers */}
        <div
          className={`bg-muted/50 z-[80] grid shrink-0 border-b ${gridColsClass}`}
        >
          {DAY_HEADERS.map((day) => (
            <div
              key={day}
              className="text-muted-foreground py-2 text-center text-[9px] font-black uppercase tracking-widest lg:text-[10px]"
            >
              {day}
            </div>
          ))}
          <div className="text-primary hidden py-2 text-center text-[9px] font-black lowercase tracking-widest lg:block">
            totals
          </div>
        </div>

        {/* Weeks */}
        <div className="flex flex-col gap-2 p-2 lg:block lg:p-0">
          {weeks.map((week, wIdx) => {
            const { sportTotals, weekTotals, activeGoals } =
              calculateWeekSummary(week);
            const weekStart = formatDateToLocalISO(week[0]);
            return (
              <div
                key={wIdx}
                className="flex flex-col rounded-xl border bg-card shadow-sm overflow-hidden lg:contents"
                data-week-start={weekStart}
              >
                {/* Week grid */}
                <div
                  className={`grid min-h-[120px] lg:border-b lg:min-h-[160px] ${gridColsClass}`}
                >
                  {week.map((date, dIdx) => {
                    const dateStr = formatDateToLocalISO(date);
                    const dayWorkouts = workouts
                      .filter((w) => w.date === dateStr)
                      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                    const dayNotes = notes.filter((n) => n.date === dateStr);
                    const dayEvents = events.filter((e) => e.date === dateStr);
                    const isToday =
                      formatDateToLocalISO(new Date()) === dateStr;
                    const isSelected = selectedDate === dateStr;
                    const isSameMonth = date.getMonth() === displayMonth;
                    const weekLabel =
                      dIdx === 0
                        ? hideDates
                          ? `Week ${wIdx + 1}`
                          : `Wk ${wIdx + 1}`
                        : undefined;

                    return (
                      <CalendarDay
                        key={dIdx}
                        date={date}
                        workouts={dayWorkouts}
                        notes={dayNotes}
                        events={dayEvents}
                        isToday={isToday}
                        isSelected={isSelected}
                        isSameMonth={isSameMonth}
                        displayMonth={displayMonth}
                        onSelect={onSelect}
                        onDragOver={onDragOver}
                        onDragLeave={onDragLeave}
                        onDrop={onDrop}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                        onEventDragStart={onEventDragStart}
                        sportMap={sportMap}
                        userSettingsMap={userSettingsMap}
                        showStats={true}
                        onEditWorkout={onEditWorkout}
                        onEditNote={onEditNote}
                        onEditEvent={onEditEvent}
                        isDraggingId={isDraggingId}
                        dragOverInfo={dragOverInfo}
                        todayRef={todayRef}
                        hideDates={hideDates}
                        weekLabel={weekLabel}
                      />
                    );
                  })}

                  {/* Week summary column - desktop only */}
                  <div className="bg-primary/5 hidden flex-col gap-3 border-l p-3 lg:flex">
                    <div className="text-primary text-xl font-black leading-none">
                      {formatMinsShort(weekTotals.duration)}
                    </div>
                    <div className="border-primary/10 space-y-2.5 border-t pt-3">
                      {Object.entries(sportTotals).map(([stId, sTotal]) => {
                        if (sTotal.duration === 0) return null;
                        const st = sportMap.get(stId);
                        const sportColor = getEffortColor(
                          st,
                          2,
                          userSettingsMap.get(stId),
                        );
                        return (
                          <div key={stId} className="flex flex-col">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: sportColor,
                                }}
                              />
                              <span className="text-muted-foreground text-[10px] font-bold">
                                {st?.name || 'Unknown'}
                              </span>
                            </div>
                            <div className="flex flex-col gap-0.5 pl-3.5">
                              <span className="text-[10px] font-bold leading-none">
                                {formatMinsShort(sTotal.duration)}
                              </span>
                              {sTotal.distance > 0 &&
                                isPaceRelevant(
                                  !!st?.paceRelevant,
                                  st?.paceUnit,
                                ) && (
                                  <span className="text-muted-foreground text-[9px] leading-none">
                                    {sTotal.distance.toFixed(1)}
                                    {st.distanceUnit || 'km'}
                                  </span>
                                )}

                              {/* Goal Progress */}
                              {activeGoals
                                .filter((g) => g.sportTypeId === stId)
                                .map((goal) => {
                                  const actual =
                                    goal.metric === 'duration'
                                      ? sTotal.duration
                                      : sTotal.distance;
                                  const target = goal.targetValue;
                                  const percent = Math.min(
                                    100,
                                    Math.round((actual / (target || 1)) * 100),
                                  );
                                  return (
                                    <div
                                      key={goal.id}
                                      className="mt-1.5 flex flex-col gap-1"
                                    >
                                      <div className="flex justify-between text-[8px] font-black uppercase opacity-60">
                                        <span>goal: {percent}%</span>
                                        <span>
                                          {goal.metric === 'duration'
                                            ? formatMinsShort(target)
                                            : `${target}${st?.distanceUnit || 'km'}`}
                                        </span>
                                      </div>
                                      <div className="h-1 w-full rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
                                        <div
                                          className={`h-full ${actual >= target ? 'bg-green-500' : 'bg-red-500'}`}
                                          style={{
                                            width: `${percent}%`,
                                          }}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Week summary row - mobile only */}
                <div className="bg-primary/5 px-3 py-2 lg:hidden border-t">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-2">
                      {Object.entries(sportTotals).map(([stId, sTotal]) => {
                        if (sTotal.duration === 0) return null;
                        const st = sportMap.get(stId);
                        const sportName = st?.name || 'Unknown';
                        const IconComponent = getSportIcon(
                          sportName,
                          st?.paceUnit,
                        );
                        const sportColor = getEffortColor(
                          st,
                          2,
                          userSettingsMap.get(stId),
                        );

                        return (
                          <div key={stId} className="flex items-center gap-1.5">
                            <div className="flex items-center gap-1">
                              {IconComponent && (
                                <IconComponent
                                  className="h-3 w-3 shrink-0"
                                  style={{ color: sportColor }}
                                />
                              )}
                              <span className="text-[10px] font-bold opacity-70">
                                {sportName}
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <div className="flex items-baseline gap-1">
                                <span className="text-[10px] font-bold leading-none">
                                  {formatMinsShort(sTotal.duration)}
                                </span>
                                {sTotal.distance > 0 &&
                                  isPaceRelevant(
                                    !!st?.paceRelevant,
                                    st?.paceUnit,
                                  ) && (
                                    <span className="text-muted-foreground text-[9px] font-bold leading-none italic">
                                      {sTotal.distance.toFixed(1)}
                                      {st.distanceUnit || 'km'}
                                    </span>
                                  )}
                              </div>

                              {/* Mobile Goal Progress */}
                              {activeGoals
                                .filter((g) => g.sportTypeId === stId)
                                .map((goal) => {
                                  const actual =
                                    goal.metric === 'duration'
                                      ? sTotal.duration
                                      : sTotal.distance;
                                  const target = goal.targetValue;
                                  const percent = Math.min(
                                    100,
                                    Math.round((actual / (target || 1)) * 100),
                                  );
                                  return (
                                    <div
                                      key={goal.id}
                                      className="h-0.5 w-12 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden mt-0.5"
                                    >
                                      <div
                                        className={`h-full ${actual >= target ? 'bg-green-500' : 'bg-red-500'}`}
                                        style={{ width: `${percent}%` }}
                                      />
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="shrink-0 border-l border-primary/10 pl-3 pt-0.5">
                      <span className="text-primary text-xs font-bold">
                        {formatMinsShort(weekTotals.duration)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);
