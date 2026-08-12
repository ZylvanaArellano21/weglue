import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LegalDocumentList } from './LegalDocumentList';
import { profileColors, profileFonts } from '../profile/profileTheme';

// Presented OVER the current screen (signup, in practice) so closing it never
// navigates anywhere — whatever the caller already had on screen (typed form
// fields included) is simply still there, untouched, underneath.
export function LegalModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Terms & Privacy Policy</Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={24} color={profileColors.textDark} />
          </TouchableOpacity>
        </View>
        <LegalDocumentList />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: profileColors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: {
    fontFamily: profileFonts.bold,
    fontSize: 16,
    color: profileColors.textDark,
  },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
