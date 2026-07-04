import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { profileColors, profileFonts, profileShadow } from './profileTheme';

interface ProfileConfirmationModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ProfileConfirmationModal({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
  loading = false,
}: ProfileConfirmationModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onCancel}
              activeOpacity={0.7}
              disabled={loading}
            >
              <Text style={styles.cancelLabel}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, destructive && styles.destructiveBtn]}
              onPress={onConfirm}
              activeOpacity={0.7}
              disabled={loading}
            >
              <Text style={styles.confirmLabel}>
                {loading ? '…' : confirmLabel}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: profileColors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    backgroundColor: profileColors.bg,
    borderRadius: 20,
    padding: 24,
    ...profileShadow,
  },
  title: {
    fontFamily: profileFonts.bold,
    fontSize: 18,
    color: profileColors.textDark,
    marginBottom: 10,
    textAlign: 'center',
  },
  message: {
    fontFamily: profileFonts.regular,
    fontSize: 15,
    color: profileColors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: profileColors.border,
    borderRadius: 40,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: profileColors.bg,
  },
  cancelLabel: {
    fontFamily: profileFonts.semiBold,
    fontSize: 15,
    color: profileColors.textDark,
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: profileColors.teal,
    borderRadius: 40,
    paddingVertical: 13,
    alignItems: 'center',
    ...profileShadow,
  },
  destructiveBtn: {
    backgroundColor: profileColors.alertRed,
  },
  confirmLabel: {
    fontFamily: profileFonts.semiBold,
    fontSize: 15,
    color: profileColors.bg,
  },
});
