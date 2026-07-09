import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  LEGAL_EFFECTIVE_DATE,
  TERMS_AND_CONDITIONS_INTRO,
  TERMS_AND_CONDITIONS_SECTIONS,
  TERMS_AND_CONDITIONS_TITLE,
  type LegalSection,
} from '@weglue/shared';
import { ProfileScreenHeader } from '../../components/profile/ProfileScreenHeader';
import { profileColors, profileFonts } from '../../components/profile/profileTheme';

// Single legal document: the Terms and the Privacy Policy live in one
// scrollable screen with no legal links inside the content. Rendered as a
// FlatList of sections so the long document stays smooth on both platforms.
export default function TermsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileScreenHeader title="Terms & Conditions" onBack={() => router.back()} />
      <FlatList<LegalSection>
        data={TERMS_AND_CONDITIONS_SECTIONS}
        keyExtractor={(section) => section.heading}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={9}
        ListHeaderComponent={
          <View>
            <Text style={styles.docTitle}>{TERMS_AND_CONDITIONS_TITLE}</Text>
            <Text style={styles.docDate}>
              Effective and last updated: {LEGAL_EFFECTIVE_DATE}
            </Text>
            {TERMS_AND_CONDITIONS_INTRO.map((paragraph, i) => (
              <Text key={i} style={styles.paragraph}>
                {paragraph}
              </Text>
            ))}
          </View>
        }
        renderItem={({ item }) => (
          <View>
            <Text style={styles.sectionHeading}>{item.heading}</Text>
            {item.body.map((paragraph, i) =>
              paragraph.startsWith('• ') ? (
                <View key={i} style={styles.bulletRow}>
                  <Text style={styles.bulletDot}>{'•'}</Text>
                  <Text style={styles.bulletText}>{paragraph.slice(2)}</Text>
                </View>
              ) : (
                <Text key={i} style={styles.paragraph}>
                  {paragraph}
                </Text>
              ),
            )}
          </View>
        )}
        ListFooterComponent={<View style={{ height: 40 }} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: profileColors.bg },
  content: { paddingHorizontal: 20, paddingTop: 8 },
  docTitle: {
    fontFamily: profileFonts.displayExtraBold,
    fontSize: 26,
    color: profileColors.textDark,
    marginBottom: 4,
  },
  docDate: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.textMuted,
    marginBottom: 16,
  },
  sectionHeading: {
    fontFamily: profileFonts.bold,
    fontSize: 16,
    color: profileColors.textDark,
    marginTop: 18,
    marginBottom: 8,
    lineHeight: 22,
  },
  paragraph: {
    fontFamily: profileFonts.regular,
    fontSize: 13.5,
    color: profileColors.textMuted,
    lineHeight: 21,
    marginBottom: 10,
  },
  bulletRow: {
    flexDirection: 'row',
    paddingLeft: 6,
    marginBottom: 6,
  },
  bulletDot: {
    fontFamily: profileFonts.regular,
    fontSize: 13.5,
    color: profileColors.textMuted,
    lineHeight: 21,
    marginRight: 8,
  },
  bulletText: {
    flex: 1,
    fontFamily: profileFonts.regular,
    fontSize: 13.5,
    color: profileColors.textMuted,
    lineHeight: 21,
  },
});
