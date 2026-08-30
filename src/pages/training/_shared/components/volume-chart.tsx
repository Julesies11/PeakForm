import { memo, useMemo } from 'react';
import { getEventTypeTheme } from '@/pages/training/_shared/utils/event-theme';
import { ApexOptions } from 'apexcharts';
import { format } from 'date-fns';
import ApexChart from 'react-apexcharts';
import {
  Event,
  Note,
  SportTypeRecord,
  TrainingGoal,
  Workout,
} from '@/types/training';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  findActiveGoal,
  getTargetValueForBucket,
} from '@/services/training/goals.utils';
import { isMetersDistance } from '@/services/training/pace-utils';
import { getUnfulfilledEventSegments } from '@/services/training/volume-dedup.utils';

type ProgressMetric = 'distance' | 'duration';
type ViewType = 'week' | 'month';

interface VolumeChartProps {
  workouts: Workout[];
  events: Event[];
  notes?: Note[];
  goals?: TrainingGoal[];
  sportTypes?: SportTypeRecord[];
  metric: ProgressMetric;
  sportId: string | 'All';
  viewType: ViewType;
  pivotDate: Date;
  showEvents?: boolean;
  showNotes?: boolean;
  templateMode?: boolean;
  totalWeeks?: number;
}

export const VolumeChart = memo(function VolumeChart({
  workouts,
  events,
  notes = [],
  goals = [],
  sportTypes = [],
  metric,
  sportId,
  viewType,
  pivotDate,
  showEvents = true,
  showNotes = true,
  templateMode = false,
  totalWeeks,
}: VolumeChartProps) {
  const isMobile = useIsMobile();

  const chartData = useMemo(() => {
    const data = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let unitCount =
      viewType === 'week' ? (isMobile ? 12 : 24) : isMobile ? 8 : 16;

    const start = new Date(pivotDate);
    if (templateMode && viewType === 'week') {
      unitCount = totalWeeks || 4;
      start.setTime(new Date(2024, 0, 1).getTime());
    } else if (viewType === 'week') {
      start.setDate(start.getDate() - Math.floor(unitCount / 2) * 7);
      const day = start.getDay();
      const diff = start.getDate() - (day === 0 ? 6 : day - 1);
      start.setDate(diff);
    } else {
      start.setMonth(start.getMonth() - Math.floor(unitCount / 2));
      start.setDate(1);
    }

    // PHASE 3: Algorithmic Optimization
    const workoutsByDate = new Map<string, Workout[]>();
    workouts.forEach((w) => {
      const dateStr = w.date;
      if (!workoutsByDate.has(dateStr)) workoutsByDate.set(dateStr, []);
      workoutsByDate.get(dateStr)!.push(w);
    });

    const eventsByDate = new Map<string, Event[]>();
    events.forEach((e) => {
      const dateStr = e.date;
      if (!eventsByDate.has(dateStr)) eventsByDate.set(dateStr, []);
      eventsByDate.get(dateStr)!.push(e);
    });

    const notesByDate = new Map<string, Note[]>();
    notes.forEach((n) => {
      const dateStr = n.date;
      if (!notesByDate.has(dateStr)) notesByDate.set(dateStr, []);
      notesByDate.get(dateStr)!.push(n);
    });

    const sportMap = new Map(sportTypes.map((st) => [st.id, st]));
    const selectedSportId = sportId !== 'All' ? sportId : undefined;
    const selectedSportRecord = selectedSportId
      ? sportMap.get(selectedSportId)
      : undefined;

    const cursor = new Date(start);
    for (let i = 0; i < unitCount; i++) {
      const bucketStart = new Date(cursor);
      const bucketEnd = new Date(cursor);
      if (viewType === 'week') {
        bucketEnd.setDate(bucketEnd.getDate() + 7);
      } else {
        bucketEnd.setMonth(bucketEnd.getMonth() + 1);
      }

      let label = '';
      if (templateMode) {
        // In template mode, we show relative week/month count from a base
        // The user asked for "Week numbers".
        const baseDate = new Date(2024, 0, 1);
        const diffTime = Math.abs(bucketStart.getTime() - baseDate.getTime());
        const diffWeeks = Math.floor(diffTime / (1000 * 60 * 60 * 24 * 7)) + 1;
        label = `Week ${diffWeeks}`;
      } else {
        label =
          viewType === 'week'
            ? `${bucketStart.getDate()} ${bucketStart.toLocaleDateString('en-US', { month: 'short' }).toLowerCase()}`
            : bucketStart
                .toLocaleDateString('en-US', {
                  month: 'short',
                  year: '2-digit',
                })
                .toLowerCase();
      }

      let val = 0;
      const bucketEvents: Event[] = [];
      const bucketNotes: Note[] = [];

      const tempDate = new Date(bucketStart);
      while (tempDate < bucketEnd) {
        const dateStr = format(tempDate, 'yyyy-MM-dd');

        const dayWorkouts = workoutsByDate.get(dateStr) || [];
        const dayEvents = eventsByDate.get(dateStr) || [];

        // Accumulate workouts
        dayWorkouts.forEach((w) => {
          // FIX: Compare by ID if a specific sport is selected
          if (selectedSportId && w.sportTypeId !== selectedSportId) return;

          if (metric === 'distance') {
            const distKm = w.plannedDistanceKilometers || 0;
            const sportRec = sportMap.get(w.sportTypeId);
            const dist =
              sportRec && isMetersDistance(sportRec.distanceUnit, sportRec.name)
                ? distKm * 1000
                : distKm;
            val += dist;
          } else {
            val += w.plannedDurationMinutes || 0;
          }
        });

        // Accumulate events & unfulfilled segments
        dayEvents.forEach((e) => bucketEvents.push(e));

        const unfulfilledSegments = getUnfulfilledEventSegments(
          dayEvents,
          dayWorkouts,
        );
        unfulfilledSegments.forEach((seg) => {
          if (selectedSportId && seg.sportTypeId !== selectedSportId) return;

          if (metric === 'distance') {
            const distKm = seg.plannedDistanceKilometers || 0;
            const sportRec = sportMap.get(seg.sportTypeId);
            const dist =
              sportRec && isMetersDistance(sportRec.distanceUnit, sportRec.name)
                ? distKm * 1000
                : distKm;
            val += dist;
          } else {
            val += seg.plannedDurationMinutes || 0;
          }
        });

        // Accumulate notes
        (notesByDate.get(dateStr) || []).forEach((n) => bucketNotes.push(n));

        tempDate.setDate(tempDate.getDate() + 1);
      }

      if (metric === 'duration') {
        val = val / 60;
      }

      const activeGoal = findActiveGoal(
        goals,
        selectedSportId,
        metric,
        bucketStart,
        bucketEnd,
      );
      const targetVal = getTargetValueForBucket(activeGoal, metric);

      let goalLabel = null;
      if (activeGoal) {
        const unit =
          metric === 'distance'
            ? selectedSportRecord?.distanceUnit || 'km'
            : 'h';
        const displayVal =
          metric === 'duration'
            ? (activeGoal.targetValue / 60).toFixed(1)
            : activeGoal.targetValue;
        goalLabel = `Target: ${displayVal}${unit}`;
      }

      const isPast = bucketEnd <= today;
      const isCurrent = today >= bucketStart && today < bucketEnd;

      data.push({
        label,
        past: isPast || isCurrent ? Number(val.toFixed(2)) : null,
        future: !isPast ? Number(val.toFixed(2)) : null,
        target: targetVal,
        goalTitle: goalLabel,
        isCurrent,
        bucketStart: new Date(bucketStart),
        bucketEnd: new Date(bucketEnd),
        eventInfo: bucketEvents.map((e) => {
          const theme = getEventTypeTheme(
            e.colorTheme || e.eventTypeColorTheme,
            e.icon || e.eventTypeIcon,
          );
          return { title: e.title, hex: theme.hex };
        }),
        noteInfo: bucketNotes.map((n) => ({ content: n.content })),
      });

      if (viewType === 'week') cursor.setDate(cursor.getDate() + 7);
      else cursor.setMonth(cursor.getMonth() + 1);
    }

    return data;
  }, [
    workouts,
    events,
    notes,
    goals,
    sportTypes,
    metric,
    sportId,
    viewType,
    pivotDate,
    isMobile,
    templateMode,
    totalWeeks,
  ]);

  const chartOptions: ApexOptions = useMemo(
    () => ({
      series: templateMode
        ? [
            {
              name: 'Planned',
              type: 'area',
              data: chartData.map((d) => d.past || d.future || 0),
            },
            {
              name: 'Target',
              type: 'line',
              data: chartData.map((d) => d.target),
            },
          ]
        : [
            {
              name: 'Past',
              type: 'area',
              data: chartData.map((d) => d.past),
            },
            {
              name: 'Future',
              type: 'area',
              data: chartData.map((d) => d.future),
            },
            {
              name: 'Target',
              type: 'line',
              data: chartData.map((d) => d.target),
            },
          ],
      annotations: {
        xaxis: [
          ...(showEvents
            ? chartData
                .filter((d) => d.eventInfo && d.eventInfo.length > 0)
                .map((d, index) => {
                  const firstEvent = d.eventInfo[0];
                  return {
                    x: d.label,
                    strokeDashArray: 4,
                    borderColor: firstEvent.hex,
                    borderWidth: 2,
                    label: {
                      borderColor: firstEvent.hex,
                      position: 'top',
                      style: {
                        color: '#fff',
                        background: firstEvent.hex,
                        fontSize: '10px',
                        fontWeight: 700,
                        padding: { left: 4, right: 4, top: 2, bottom: 2 },
                      },
                      text:
                        firstEvent.title + (d.eventInfo.length > 1 ? ' +' : ''),
                      offsetY: index % 2 === 0 ? -25 : 0,
                      orientation: 'horizontal',
                    },
                  };
                })
            : []),
          ...(showNotes
            ? chartData
                .filter((d) => d.noteInfo && d.noteInfo.length > 0)
                .map((d, index) => {
                  const firstNote = d.noteInfo[0];
                  const noteColor = '#374151'; // Dark grey (gray-700) for notes
                  return {
                    x: d.label,
                    strokeDashArray: 2,
                    borderColor: noteColor,
                    borderWidth: 1,
                    label: {
                      borderColor: noteColor,
                      position: 'top',
                      style: {
                        color: '#fff',
                        background: noteColor,
                        fontSize: '10px',
                        fontWeight: 700,
                        padding: { left: 4, right: 4, top: 2, bottom: 2 },
                      },
                      text:
                        (firstNote.content.length > 15
                          ? firstNote.content.substring(0, 15) + '...'
                          : firstNote.content) +
                        (d.noteInfo.length > 1 ? ' +' : ''),
                      offsetY: index % 2 === 0 ? 70 : 95,
                      orientation: 'horizontal',
                    },
                  };
                })
            : []),
        ],
        points: chartData.reduce(
          (acc, d, i) => {
            // Add label if target exists and it's the first point or different from previous point
            if (
              d.target > 0 &&
              d.goalTitle &&
              (i === 0 || chartData[i - 1].goalTitle !== d.goalTitle)
            ) {
              acc?.push({
                x: d.label,
                y: d.target,
                marker: { size: 0 },
                label: {
                  borderColor: '#ef4444',
                  style: {
                    color: '#fff',
                    background: '#ef4444',
                    fontSize: '9px',
                    fontWeight: 700,
                    padding: { left: 4, right: 4, top: 2, bottom: 2 },
                  },
                  text: d.goalTitle,
                  offsetY: -10,
                  textAnchor: 'start',
                },
              });
            }
            return acc;
          },
          [] as Exclude<ApexOptions['annotations'], undefined>['points'],
        ),
      },
      chart: {
        height: 300,
        type: 'line',
        toolbar: { show: false },
        zoom: { enabled: false },
        selection: {
          enabled: false,
        },
      },
      dataLabels: { enabled: false },
      legend: {
        show: false,
      },
      stroke: {
        curve: templateMode
          ? (['smooth', 'stepline'] as const)
          : (['smooth', 'smooth', 'stepline'] as const),
        width: templateMode ? [3, 4] : [3, 3, 4],
        colors: templateMode
          ? ['#3b82f6', '#ef4444']
          : ['#3b82f6', '#8b5cf6', '#ef4444'],
        dashArray: templateMode ? [0, 0] : [0, 5, 0],
      },
      fill: {
        type: templateMode
          ? (['gradient', 'solid'] as const)
          : (['gradient', 'gradient', 'solid'] as const),
        gradient: {
          opacityFrom: templateMode ? [0.25, 0] : [0.25, 0.1, 0],
          opacityTo: [0, 0, 0],
        },
      },
      colors: templateMode
        ? ['#3b82f6', '#ef4444']
        : ['#3b82f6', '#8b5cf6', '#ef4444'],
      xaxis: {
        categories: chartData.map((d) => d.label),
        axisBorder: { show: false },
        axisTicks: { show: false },
        crosshairs: {
          show: true,
          width: 1,
          position: 'back',
          opacity: 0.9,
          stroke: {
            color: '#6366f1',
            width: 1,
            dashArray: 4,
          },
        },
        tooltip: {
          enabled: false,
        },
        labels: {
          rotate: -90,
          rotateAlways: true,
          style: {
            colors: chartData.map((d) => (d.isCurrent ? '#3b82f6' : '#888')),
            fontSize: '10px',
            fontWeight: 800,
          },
        },
      },
      yaxis: {
        min: 0,
        labels: {
          style: {
            colors: '#888',
            fontSize: '10px',
            fontWeight: 700,
          },
          formatter: (value: number) => {
            if (metric === 'duration') return `${value}h`;
            let unit = 'km';
            if (sportId !== 'All') {
              const sportRec = sportTypes.find((st) => st.id === sportId);
              if (
                sportRec &&
                isMetersDistance(sportRec.distanceUnit, sportRec.name)
              ) {
                unit = 'm';
              }
            }
            return `${value}${unit}`;
          },
        },
      },
      grid: {
        borderColor: '#e5e7eb',
        strokeDashArray: 5,
        yaxis: { lines: { show: true } },
        xaxis: { lines: { show: false } },
      },
      tooltip: {
        enabled: true,
        shared: true,
        intersect: false,
        followCursor: false,
        custom: function ({ series, seriesIndex, dataPointIndex }) {
          const value = series[seriesIndex][dataPointIndex];
          if (value === null || value === undefined) return '';

          const dataPoint = chartData[dataPointIndex];
          let unit = metric === 'duration' ? 'h' : 'km';
          if (metric === 'distance' && sportId !== 'All') {
            const sportRec = sportTypes.find((st) => st.id === sportId);
            if (
              sportRec &&
              isMetersDistance(sportRec.distanceUnit, sportRec.name)
            ) {
              unit = 'm';
            }
          }

          // Calculate total for this data point
          // Use Math.max to avoid double-counting the current point where past and future overlap
          const total = Math.max(dataPoint.past || 0, dataPoint.future || 0);

          // Format date range
          let dateRange = '';
          if (templateMode) {
            dateRange = dataPoint.label;
          } else if (viewType === 'week') {
            const startDate = dataPoint.bucketStart;
            const endDate = new Date(dataPoint.bucketEnd);
            endDate.setDate(endDate.getDate() - 1); // Adjust to last day of week

            const formatDay = (date: Date) => {
              const day = date.getDate();
              const suffix =
                day === 1 || day === 21 || day === 31
                  ? 'st'
                  : day === 2 || day === 22
                    ? 'nd'
                    : day === 3 || day === 23
                      ? 'rd'
                      : 'th';
              return `${date.toLocaleDateString('en-US', { month: 'short' })} ${day}${suffix}`;
            };

            dateRange = `${formatDay(startDate)} - ${formatDay(endDate)}`;
          } else {
            dateRange = dataPoint.bucketStart.toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric',
            });
          }

          const eventsHtml =
            showEvents && dataPoint.eventInfo?.length > 0
              ? `
            <div style="margin-top: 8px; border-top: 1px solid #eee; pt-2">
              <div style="font-size: 10px; font-weight: 700; color: #888; text-transform: lowercase; margin-bottom: 4px;">events</div>
              ${dataPoint.eventInfo
                .map(
                  (e: { hex: string; title: string }) => `
                <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 2px;">
                  <div style="width: 8px; height: 8px; border-radius: 2px; background: ${e.hex};"></div>
                  <div style="font-size: 11px; font-weight: 600; color: #333;">${e.title}</div>
                </div>
              `,
                )
                .join('')}
            </div>
          `
              : '';

          const notesHtml =
            showNotes && dataPoint.noteInfo?.length > 0
              ? `
            <div style="margin-top: 8px; border-top: 1px solid #eee; pt-2">
              <div style="font-size: 10px; font-weight: 700; color: #888; text-transform: lowercase; margin-bottom: 4px;">notes</div>
              ${dataPoint.noteInfo
                .map(
                  (n: { content: string }) => `
                <div style="display: flex; align-items: flex-start; gap: 4px; margin-bottom: 4px;">
                  <div style="width: 8px; height: 8px; border-radius: 2px; background: #374151; margin-top: 3px; flex-shrink: 0;"></div>
                  <div style="font-size: 11px; font-weight: 500; color: #555; line-height: 1.3;">${n.content}</div>
                </div>
              `,
                )
                .join('')}
            </div>
          `
              : '';

          return `<div class="apexcharts-tooltip-custom" style="padding: 10px 14px; background: white; border: 1px solid #e5e7eb; border-radius: 10px; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); min-width: 180px;">
          <div style="font-size: 11px; font-weight: 700; color: #666; text-transform: lowercase; margin-bottom: 4px;">${dateRange}</div>
          <div style="font-size: 14px; font-weight: 800; color: #111; margin-bottom: 2px;">total: ${total.toFixed(2)}${unit}</div>
          ${eventsHtml}
          ${notesHtml}
        </div>`;
        },
      },
      markers: {
        size: [0, 0, 0],
        hover: {
          size: 6,
        },
      },
      states: {
        hover: {
          filter: {
            type: 'none',
          },
        },
        active: {
          filter: {
            type: 'none',
          },
        },
      },
    }),
    [
      chartData,
      metric,
      viewType,
      showEvents,
      showNotes,
      sportId,
      sportTypes,
      templateMode,
    ],
  );

  return (
    <ApexChart
      options={chartOptions}
      series={chartOptions.series}
      height={300}
    />
  );
});
