import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { chatColors, chatFonts, chatShadow } from './chatTheme';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationModal({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
              <Text style={styles.cancelLabel}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, destructive && styles.destructiveBtn]}
              onPress={onConfirm}
              activeOpacity={0.7}
            >
              <Text style={styles.confirmLabel}>{confirmLabel}</Text>
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
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    backgroundColor: chatColors.bg,
    borderRadius: 20,
    padding: 24,
    ...chatShadow,
  },
  title: {
    fontFamily: chatFonts.semiBold,
    fontSize: 18,
    color: chatColors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontFamily: chatFonts.regular,
    fontSize: 15,
    color: chatColors.textMuted,
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
    borderColor: chatColors.border,
    borderRadius: 40,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: chatColors.bg,
  },
  cancelLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 15,
    color: chatColors.text,
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: chatColors.teal,
    borderRadius: 40,
    paddingVertical: 12,
    alignItems: 'center',
    ...chatShadow,
  },
  destructiveBtn: {
    backgroundColor: '#C62828',
  },
  confirmLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 15,
    color: chatColors.cream,
  },
});
