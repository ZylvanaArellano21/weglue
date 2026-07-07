import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { profileColors, profileFonts } from './profileTheme';

const INTERESTS_CAP = 5;

// Inline interests display used on every profile (own + other users).
// Shows the first 5 interests; "Show more" expands in place (Instagram-bio
// style), "Show less" collapses back. Renders nothing when the list is empty
// (e.g. the owner hides interests — enforced server-side by RLS).
export function InterestsLine({ interests }: { interests: string[] }) {
  const [expanded, setExpanded] = useState(false);

  if (interests.length === 0) return null;

  const visible = expanded ? interests : interests.slice(0, INTERESTS_CAP);
  const hasMore = interests.length > INTERESTS_CAP;

  return (
    <View style={styles.section}>
      <Text style={styles.tagLine}>
        {visible.map((i) => `~${i}`).join('  ')}
      </Text>
      {hasMore && (
        <TouchableOpacity
          onPress={() => setExpanded((prev) => !prev)}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={styles.showMore}>{expanded ? 'Show less' : 'Show more'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 12 },
  tagLine: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.textMuted,
    lineHeight: 20,
  },
  showMore: {
    fontFamily: profileFonts.medium,
    fontSize: 13,
    color: profileColors.teal,
    marginTop: 4,
  },
});
