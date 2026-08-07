import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CountBadge } from '../shared/CountBadge';
import { chatColors, chatShadow, chatSizes, chatTypography } from './chatTheme';

export type ChatFilter = 'single' | 'group';

interface Props {
  value: ChatFilter;
  onChange: (value: ChatFilter) => void;
  /** Unread MESSAGES in one-to-one conversations. Badge hides at 0. */
  singleUnread?: number;
  /** Unread MESSAGES in custom groups + club member/officer chats. */
  groupUnread?: number;
}

export function FilterPills({ value, onChange, singleUnread = 0, groupUnread = 0 }: Props) {
  return (
    <View style={styles.row}>
      {(['single', 'group'] as ChatFilter[]).map((filter) => {
        const active = value === filter;
        const unread = filter === 'single' ? singleUnread : groupUnread;
        return (
          // The pill sits in its own wrapper so the badge can overhang without
          // being clipped by the pill's own rounded bounds.
          <View key={filter} style={styles.pillWrap}>
            <TouchableOpacity
              style={[styles.pill, active ? styles.pillActive : styles.pillInactive]}
              onPress={() => onChange(filter)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={
                unread > 0
                  ? `${filter === 'single' ? 'Single' : 'Group'}, ${unread} unread messages`
                  : undefined
              }
              hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            >
              <Text
                style={[
                  chatTypography.filterPill,
                  { color: active ? chatColors.cream : chatColors.teal },
                ]}
              >
                {filter === 'single' ? 'Single' : 'Group'}
              </Text>
            </TouchableOpacity>
            <CountBadge count={unread} style={styles.badge} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 23,
    // Room for the badge to overhang the first pill's top-right corner.
    paddingTop: 6,
    paddingRight: 6,
  },
  pillWrap: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
  },
  pill: {
    minWidth: chatSizes.filterPillMinWidth,
    height: chatSizes.filterPillHeight,
    paddingHorizontal: 18,
    borderRadius: chatSizes.filterPillRadius,
    alignItems: 'center',
    justifyContent: 'center',
    ...chatShadow,
  },
  pillActive: {
    backgroundColor: chatColors.teal,
  },
  pillInactive: {
    backgroundColor: chatColors.bg,
  },
});
