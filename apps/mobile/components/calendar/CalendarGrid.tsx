import { useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  calendarColors,
  calendarSizes,
  calendarShadow,
  calendarTypography,
} from './calendarTheme';

const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface CalendarGridProps {
  markedDates: string[];
  today: string;
  year: number;
  month: number;
  onDayPress: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

interface GridCell {
  date: string;
  day: number;
  isCurrentMonth: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function buildGridCells(year: number, month: number): GridCell[] {
  const firstDay = new Date(year, month - 1, 1);
  // Monday = 0 … Sunday = 6
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells: GridCell[] = [];

  for (let i = 0; i < startOffset; i++) {
    cells.push({ date: '', day: 0, isCurrentMonth: false });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      date: toDateStr(year, month, d),
      day: d,
      isCurrentMonth: true,
    });
  }

  const trailing = (7 - (cells.length % 7)) % 7;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  for (let d = 1; d <= trailing; d++) {
    cells.push({
      date: toDateStr(nextYear, nextMonth, d),
      day: d,
      isCurrentMonth: false,
    });
  }

  return cells;
}

export function CalendarGrid({
  markedDates,
  today,
  year,
  month,
  onDayPress,
  onPrevMonth,
  onNextMonth,
}: CalendarGridProps) {
  const markedSet = useMemo(() => new Set(markedDates), [markedDates]);
  const cells = useMemo(() => buildGridCells(year, month), [year, month]);

  const handleCellPress = useCallback(
    (date: string) => {
      if (!date || !markedSet.has(date)) return;
      onDayPress(date);
    },
    [markedSet, onDayPress],
  );

  return (
    <View style={styles.wrapper}>
      <View style={styles.card}>
        <View style={styles.monthRow}>
          <Text style={calendarTypography.monthTitle}>
            {MONTH_NAMES[month - 1]} {year}
          </Text>
          <View style={styles.monthNav}>
            <TouchableOpacity
              onPress={onPrevMonth}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel="Previous month"
            >
              <Ionicons name="chevron-back" size={18} color={calendarColors.metaLight} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onNextMonth}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel="Next month"
            >
              <Ionicons name="chevron-forward" size={18} color={calendarColors.metaLight} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.dayHeaderRow}>
          {DAY_LABELS.map((label) => (
            <View key={label} style={styles.cell}>
              <Text style={calendarTypography.dayHeader}>{label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.grid}>
          {cells.map((cell, index) => {
            if (!cell.date) {
              return <View key={`empty-${index}`} style={styles.cell} />;
            }

            const isToday = cell.date === today;
            const hasEvent = markedSet.has(cell.date);
            const isPressable = hasEvent;

            return (
              <TouchableOpacity
                key={cell.date}
                style={[
                  styles.cell,
                  !cell.isCurrentMonth && styles.trailingCell,
                ]}
                onPress={() => handleCellPress(cell.date)}
                activeOpacity={isPressable ? 0.7 : 1}
                disabled={!isPressable}
                accessibilityRole={isPressable ? 'button' : 'text'}
                accessibilityLabel={
                  isToday
                    ? `Today, ${cell.day}${hasEvent ? ', has events' : ''}`
                    : `${cell.day}${hasEvent ? ', has events' : ''}`
                }
              >
                <View style={styles.dayContent}>
                  {isToday ? (
                    <View style={styles.todayCircle}>
                      <Text style={calendarTypography.dayNumberToday}>{cell.day}</Text>
                    </View>
                  ) : (
                    <Text
                      style={[
                        calendarTypography.dayNumber,
                        !cell.isCurrentMonth && styles.trailingDayText,
                      ]}
                    >
                      {cell.day}
                    </Text>
                  )}

                  {hasEvent && (
                    <View
                      style={[
                        styles.eventUnderline,
                        isToday ? styles.eventUnderlineToday : styles.eventUnderlineOther,
                      ]}
                    />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const cellSize = calendarSizes.gridCellSize;

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: calendarSizes.screenPaddingH,
    marginBottom: 16,
  },
  card: {
    backgroundColor: calendarColors.white,
    borderRadius: calendarSizes.gridCardRadius,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 10,
    ...calendarShadow,
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dayHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: calendarColors.gridBorder,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: '14.285714%',
    height: cellSize,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: calendarColors.gridBorder,
  },
  trailingCell: {
    backgroundColor: calendarColors.trailingDayBg,
  },
  trailingDayText: {
    color: calendarColors.trailingDayText,
  },
  dayContent: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
  },
  todayCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: calendarColors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventUnderline: {
    position: 'absolute',
    bottom: -2,
    width: 16,
    height: 2,
    borderRadius: 1,
  },
  eventUnderlineToday: {
    backgroundColor: calendarColors.alertRed,
  },
  eventUnderlineOther: {
    backgroundColor: calendarColors.teal,
  },
});
