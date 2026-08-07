import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

export type EventAudience = 'everyone' | 'members' | 'specific';

/** One red, audience-derived label shared by eligible mobile event surfaces. */
export function EventAudienceBadge({ visibility }: { visibility: EventAudience }): ReactElement | null {
  if (visibility === 'everyone') return null;
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: '#F02719',
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
      }}
    >
      <Text style={{ color: '#FFFFFF', fontSize: 11, fontFamily: 'Inter_700Bold' }}>
        {visibility === 'specific' ? 'Selected members only' : 'Members only'}
      </Text>
    </View>
  );
}
