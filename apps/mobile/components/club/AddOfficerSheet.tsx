import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../shared/Avatar';
import {
  searchUniversityUsers,
  type UniversityUser,
} from '../../services/clubService';

const CREAM = '#FEFCF0';
const TEAL = '#0FA6A6';
const INK = '#111827';
const MUTED = '#6B7280';
const BORDER = '#E5E7EB';

// Real officer-assignment flow (replaces the old toast-only button):
//   1. Search people from the SAME university (name / username, with avatar).
//   2. Pick the person.
//   3. Type their role (President, Vice President, Treasurer, any custom text).
//   4. Add → parent runs the add_club_officer RPC.
interface AddOfficerSheetProps {
  visible: boolean;
  viewerUserId: string;
  /** Users who are already officers — shown as non-selectable. */
  existingOfficerIds: string[];
  onAdd: (user: UniversityUser, roleTitle: string) => Promise<void>;
  onClose: () => void;
}

export function AddOfficerSheet({
  visible,
  viewerUserId,
  existingOfficerIds,
  onAdd,
  onClose,
}: AddOfficerSheetProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UniversityUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<UniversityUser | null>(null);
  const [roleTitle, setRoleTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset per open so a previous session's selection never leaks in.
  useEffect(() => {
    if (visible) {
      setQuery('');
      setResults([]);
      setSelected(null);
      setRoleTitle('');
      setError(null);
      runSearch('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const runSearch = useCallback(
    (q: string) => {
      setSearching(true);
      searchUniversityUsers(viewerUserId, q)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    },
    [viewerUserId],
  );

  const handleQueryChange = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(q), 350);
  };

  const trimmedRole = roleTitle.trim();
  const canSubmit = !!selected && trimmedRole.length >= 2 && trimmedRole.length <= 40 && !submitting;

  const handleAdd = async () => {
    if (!selected || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAdd(selected, trimmedRole);
      onClose();
    } catch {
      setError('Could not add officer. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Add Officer</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={INK} />
            </TouchableOpacity>
          </View>

          {!selected ? (
            <>
              <View style={styles.searchBox}>
                <Ionicons name="search" size={16} color={MUTED} />
                <TextInput
                  value={query}
                  onChangeText={handleQueryChange}
                  placeholder="Search people at your school..."
                  placeholderTextColor="#9CA3AF"
                  style={styles.searchInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {searching ? (
                <View style={styles.centerBox}>
                  <ActivityIndicator color={TEAL} />
                </View>
              ) : (
                <FlatList
                  data={results}
                  keyExtractor={(u) => u.id}
                  keyboardShouldPersistTaps="handled"
                  style={{ maxHeight: 340 }}
                  renderItem={({ item }) => {
                    const alreadyOfficer = existingOfficerIds.includes(item.id);
                    return (
                      <TouchableOpacity
                        onPress={() => !alreadyOfficer && setSelected(item)}
                        disabled={alreadyOfficer}
                        activeOpacity={0.7}
                        style={[styles.userRow, alreadyOfficer && { opacity: 0.45 }]}
                      >
                        <Avatar uri={item.avatar_url} size={40} username={item.username} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.userName} numberOfLines={1}>
                            {item.full_name}
                          </Text>
                          <Text style={styles.userHandle} numberOfLines={1}>
                            @{item.username}
                            {item.university ? ` · ${item.university}` : ''}
                          </Text>
                        </View>
                        {alreadyOfficer ? (
                          <Text style={styles.alreadyLabel}>Already an officer</Text>
                        ) : (
                          <Ionicons name="chevron-forward" size={18} color={MUTED} />
                        )}
                      </TouchableOpacity>
                    );
                  }}
                  ListEmptyComponent={
                    <View style={styles.centerBox}>
                      <Text style={styles.emptyText}>
                        {query.trim()
                          ? 'No one at your school matches that search.'
                          : 'No people found at your school yet.'}
                      </Text>
                    </View>
                  }
                />
              )}
            </>
          ) : (
            <>
              {/* Selected person */}
              <View style={styles.selectedRow}>
                <Avatar uri={selected.avatar_url} size={44} username={selected.username} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>{selected.full_name}</Text>
                  <Text style={styles.userHandle}>@{selected.username}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSelected(null)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.changeLabel}>Change</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.roleLabel}>Role</Text>
              <TextInput
                value={roleTitle}
                onChangeText={setRoleTitle}
                placeholder="President, Vice President, Treasurer..."
                placeholderTextColor="#9CA3AF"
                style={styles.roleInput}
                maxLength={40}
                autoFocus
              />
              {trimmedRole.length > 0 && trimmedRole.length < 2 && (
                <Text style={styles.errorText}>Role must be at least 2 characters.</Text>
              )}
              {error && <Text style={styles.errorText}>{error}</Text>}

              <TouchableOpacity
                onPress={handleAdd}
                disabled={!canSubmit}
                activeOpacity={0.85}
                style={[styles.addBtn, !canSubmit && { backgroundColor: '#9CA3AF' }]}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.addBtnText}>Add</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: CREAM,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 34,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: INK,
    fontFamily: 'Zain_700Bold',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 11,
    fontSize: 15,
    color: INK,
    fontFamily: 'Inter_400Regular',
  },
  centerBox: { paddingVertical: 32, alignItems: 'center' },
  emptyText: {
    fontSize: 13,
    color: MUTED,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    color: INK,
    fontFamily: 'Inter_600SemiBold',
  },
  userHandle: {
    fontSize: 12,
    color: MUTED,
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
  alreadyLabel: {
    fontSize: 12,
    color: TEAL,
    fontFamily: 'Inter_600SemiBold',
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  changeLabel: {
    fontSize: 13,
    color: TEAL,
    fontFamily: 'Inter_600SemiBold',
  },
  roleLabel: {
    fontSize: 13,
    color: '#374151',
    fontFamily: 'Inter_500Medium',
    marginBottom: 6,
  },
  roleInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: INK,
    fontFamily: 'Inter_400Regular',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 12,
    color: '#F02719',
    fontFamily: 'Inter_400Regular',
    marginBottom: 6,
  },
  addBtn: {
    backgroundColor: TEAL,
    borderRadius: 25,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  addBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
  },
});
