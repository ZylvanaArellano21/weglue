import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { previewInvite, joinInvite, type InvitePreview } from '../../services/messagingService';
import { clearPendingInvite, setPendingInvite } from '../../lib/pendingInvite';
import { Avatar } from '../../components/shared/Avatar';
import { chatColors, chatFonts, chatShadow } from '../../components/chat/chatTheme';

// ─── Invite landing (in-app) ────────────────────────────────────────────────
// Reached from a deep link or from index.tsx after onboarding finishes. If the
// user is fully signed in, we validate + join automatically and open the chat.
// If not, we persist the token and route into the normal onboarding/login flow;
// this screen resumes once they're authenticated.

export default function InviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { session, isLoading } = useAuthStore();
  // A verified email is the only requirement — a missing profile picture no
  // longer means "still onboarding", so invites resolve straight away.
  const signedIn = !!session?.user?.email_confirmed_at;
  const isOnboarded = signedIn;

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [state, setState] = useState<'loading' | 'joining' | 'ready' | 'error'>('loading');
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    if (!token) return;
    let alive = true;

    (async () => {
      try {
        const p = await previewInvite(token);
        if (!alive) return;
        setPreview(p);
        if (!p.valid) {
          setState('error');
          setErrorText('This invite link is no longer valid. Ask for a new one.');
          void clearPendingInvite();
          return;
        }

        if (isLoading) return; // wait for auth to settle

        if (!signedIn || !isOnboarded) {
          // Keep the token and send them through the normal flow; they'll come
          // back here (via index.tsx) after finishing.
          await setPendingInvite(token);
          setState('ready');
          return;
        }

        // Fully authenticated → join automatically, no confirmation.
        setState('joining');
        const result = await joinInvite(token);
        await clearPendingInvite();
        if (!alive) return;

        // Open the destination chat immediately.
        if (result.type === 'club_group' && result.default_channel_id) {
          router.replace(`/chat/${result.conversation_id}/${result.default_channel_id}` as any);
        } else {
          router.replace(`/chat/${result.conversation_id}` as any);
        }
      } catch (e: any) {
        if (!alive) return;
        setState('error');
        setErrorText(
          e?.message?.includes('different_university')
            ? 'This chat is for a different university, so you can\'t join it.'
            : 'Something went wrong joining this chat. Please try again.',
        );
      }
    })();

    return () => {
      alive = false;
    };
  }, [token, isLoading, signedIn, isOnboarded]);

  const chatLabel =
    preview?.type === 'club_group'
      ? `${preview.club_name ?? 'a club'} · Members`
      : preview?.group_name || 'a group chat';

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={() => router.replace('/(tabs)/messages' as any)} style={styles.close} hitSlop={8}>
        <Ionicons name="close" size={24} color={chatColors.text} />
      </TouchableOpacity>

      <View style={styles.center}>
        {state === 'error' ? (
          <>
            <Ionicons name="alert-circle-outline" size={54} color={chatColors.textMuted} />
            <Text style={styles.title}>Can't open this invite</Text>
            <Text style={styles.body}>{errorText}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/(tabs)/messages' as any)}>
              <Text style={styles.primaryLabel}>Go to messages</Text>
            </TouchableOpacity>
          </>
        ) : state === 'ready' && (!signedIn || !isOnboarded) ? (
          <>
            {preview?.club_avatar ? (
              <Avatar uri={preview.club_avatar} size={72} username={chatLabel} />
            ) : (
              <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
            )}
            <Text style={styles.title}>You're invited to {chatLabel}</Text>
            <Text style={styles.body}>
              {preview?.creator_name ? `${preview.creator_name} invited you. ` : ''}
              Create your We Glue account or log in to join. We'll bring you straight here when you're done.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/onboarding/interests' as any)}>
              <Text style={styles.primaryLabel}>Get started</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace('/auth/login' as any)}>
              <Text style={styles.secondaryLabel}>I already have an account</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={chatColors.teal} />
            <Text style={styles.body}>{state === 'joining' ? `Joining ${chatLabel}…` : 'Checking your invite…'}</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: chatColors.bg },
  close: { padding: 16, alignSelf: 'flex-start' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  logo: { width: 90, height: 80 },
  title: {
    fontFamily: chatFonts.bold,
    fontSize: 20,
    color: chatColors.text,
    textAlign: 'center',
    marginTop: 8,
  },
  body: {
    fontFamily: chatFonts.regular,
    fontSize: 14,
    color: chatColors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  primaryBtn: {
    marginTop: 16,
    height: 50,
    paddingHorizontal: 40,
    backgroundColor: chatColors.teal,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    ...chatShadow,
  },
  primaryLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 15,
    color: chatColors.cream,
  },
  secondaryBtn: {
    marginTop: 6,
    paddingVertical: 10,
  },
  secondaryLabel: {
    fontFamily: chatFonts.semiBold,
    fontSize: 14,
    color: chatColors.teal,
  },
});
