/**
 * SidebarOverlay — Slide-in drawer from the left side of the screen.
 *
 * DATA LAYER:
 *   - isOpen / onClose come from useSidebar()
 *   - Navigation items come from buildSidebarItems(router, closeSidebar)
 *
 * Cursor (Step 2) renders the full drawer UI:
 *   - Modal with transparent background + backdrop tap-to-close
 *   - Slide-in animation from left edge (Animated.Value 0 → 1, translateX -300 → 0)
 *   - Drawer width: ~75% of screen width, capped at 320px
 *   - Header: user avatar + display name + @username
 *   - List of SidebarItem rows (icon + label; destructive items in red)
 *   - Footer: app version string
 *
 * Props:
 *   profile          OwnProfile | null      — for header avatar + name
 *   items            SidebarItem[]          — from buildSidebarItems()
 *   isOpen           boolean
 *   onClose          () => void
 */

import { Modal, View, Text, TouchableWithoutFeedback } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { useSidebar } from '../../context/SidebarContext';
import { buildSidebarItems } from '../../lib/sidebarNavigation';
import { useOwnProfile } from '../../hooks/useOwnProfile';

export function SidebarOverlay() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const { isOpen, closeSidebar } = useSidebar();
  const router = useRouter();

  const { data: profile } = useOwnProfile(userId);
  const items = buildSidebarItems(router, closeSidebar);

  // ─── Cursor: replace this stub with the full styled drawer UI ─────────────
  // Variables: isOpen, closeSidebar, profile, items
  // Each item: { key, label, icon (Ionicons name), onPress, destructive? }
  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="none"
      onRequestClose={closeSidebar}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={closeSidebar}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <TouchableWithoutFeedback>
            <View
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '75%',
                maxWidth: 320,
                backgroundColor: '#FDFBEF',
                paddingTop: 60,
                paddingHorizontal: 20,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#111' }}>
                {profile?.full_name ?? profile?.username ?? ''}
              </Text>
              {items.map((item) => (
                <Text
                  key={item.key}
                  onPress={item.onPress}
                  style={{
                    paddingVertical: 14,
                    fontSize: 15,
                    color: item.destructive ? '#EF4444' : '#111827',
                  }}
                >
                  {item.label}
                </Text>
              ))}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
