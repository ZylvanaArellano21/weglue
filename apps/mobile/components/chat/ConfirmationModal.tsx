import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';

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

/**
 * Reusable confirmation modal.
 * Used for leaving a group chat AND deleting a direct chat —
 * not two separate implementations.
 */
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
              <Text style={[styles.confirmLabel, destructive && styles.destructiveLabel]}>
                {confirmLabel}
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
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    backgroundColor: '#FEFCF0',
    borderRadius: 20,
    padding: 24,
  },
  title: {
    fontFamily: 'Zain_700Bold',
    fontSize: 18,
    color: '#1A1A1A',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontFamily: 'Zain_400Regular',
    fontSize: 15,
    color: '#4B5563',
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
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelLabel: {
    fontFamily: 'Zain_700Bold',
    fontSize: 15,
    color: '#4B5563',
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: '#0FA6A6',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  destructiveBtn: {
    backgroundColor: '#EF4444',
  },
  confirmLabel: {
    fontFamily: 'Zain_700Bold',
    fontSize: 15,
    color: '#fff',
  },
  destructiveLabel: {
    color: '#fff',
  },
});
