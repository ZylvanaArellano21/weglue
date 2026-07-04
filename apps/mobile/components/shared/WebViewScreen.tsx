import { useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import { ProfileScreenHeader } from '../profile/ProfileScreenHeader';
import { profileColors } from '../profile/profileTheme';

interface WebViewScreenProps {
  title: string;
  url: string;
}

export function WebViewScreen({ title, url }: WebViewScreenProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileScreenHeader title={title} onBack={() => router.back()} />
      <View style={styles.webWrap}>
        {loading && (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={profileColors.teal} />
          </View>
        )}
        <WebView
          source={{ uri: url }}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          style={styles.webview}
          startInLoadingState={false}
          allowsBackForwardNavigationGestures
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: profileColors.bg,
  },
  webWrap: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: profileColors.bg,
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: profileColors.bg,
    zIndex: 1,
  },
});
