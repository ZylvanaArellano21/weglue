import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ProfileScreenHeader } from '../../components/profile/ProfileScreenHeader';
import { LegalDocumentList } from '../../components/shared/LegalDocumentList';
import { profileColors } from '../../components/profile/profileTheme';
import { StyleSheet } from 'react-native';

// Single legal document: the Terms and the Privacy Policy live in one
// scrollable screen with no legal links inside the content.
export default function TermsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileScreenHeader title="Terms & Conditions" onBack={() => router.back()} />
      <LegalDocumentList />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: profileColors.bg },
});
