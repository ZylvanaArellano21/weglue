import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { profileColors, profileFonts } from './profileTheme';

interface ShowMoreSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function ShowMoreSheet({ visible, title, onClose, children }: ShowMoreSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}>
              <Ionicons name="close" size={22} color={profileColors.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: profileColors.sidebarOverlay,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: profileColors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: profileColors.border,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: profileColors.border,
  },
  title: {
    fontFamily: profileFonts.bold,
    fontSize: 16,
    color: profileColors.textDark,
  },
  content: {
    padding: 20,
    paddingBottom: 32,
    gap: 10,
  },
});
