import { View, Text, StyleSheet } from 'react-native';
import { chatTypography } from './chatTheme';

interface Props {
  label: string;
}

export function DateDivider({ label }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

export function formatChatDateDivider(isoString: string): string {
  const date = new Date(isoString);
  return date
    .toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    .toUpperCase();
}

export function isSameChatDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    marginVertical: 14,
    paddingHorizontal: 16,
  },
  label: {
    ...chatTypography.dateDivider,
    textAlign: 'center',
  },
});
