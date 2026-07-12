/**
 * Share — root-level transparent-modal route (was a RN <Modal> sheet).
 *
 * As a real route it covers/disables the tab bar and is a layer in the
 * navigation history: cancelling returns to the exact originating content, and
 * sending shows a success toast then returns to the origin — it never switches
 * to the Messages tab. The originating screen stays mounted underneath.
 */
import { useRef } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import {
  ShareSheetContent,
  type ShareContentType,
  type ShareMedia,
} from '../components/shared/ShareSheet';
import { useToast, type ToastType } from '../components/Toast';

export default function ShareScreen() {
  const router = useRouter();
  const { session } = useAuthStore();
  const params = useLocalSearchParams<{ contentType: string; contentId: string; media?: string }>();
  const { show, ToastComponent } = useToast();

  const contentType = (params.contentType as ShareContentType) ?? 'post';
  const contentId = params.contentId ?? '';
  let media: ShareMedia | undefined;
  if (params.media) {
    try {
      media = JSON.parse(params.media) as ShareMedia;
    } catch {
      media = undefined;
    }
  }

  // When a toast was just shown (send/external success), let it stay visible a
  // beat before popping back to the origin; cancel/backdrop dismiss instantly.
  const lastToastAt = useRef(0);
  const onShowToast = (message: string, type?: ToastType) => {
    lastToastAt.current = Date.now();
    show(message, type);
  };
  const onDone = () => {
    const sinceToast = Date.now() - lastToastAt.current;
    if (sinceToast < 400) {
      setTimeout(() => router.back(), 750);
    } else {
      router.back();
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ShareSheetContent
          onDone={onDone}
          userId={session?.user.id}
          contentType={contentType}
          contentId={contentId}
          media={media}
          onShowToast={onShowToast}
        />
      </KeyboardAvoidingView>
      {ToastComponent}
    </View>
  );
}
