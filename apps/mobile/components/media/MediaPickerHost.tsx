import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, StatusBar, View, StyleSheet } from 'react-native';
import { Camera } from 'expo-camera';
import { useMediaPickerStore } from '../../store/mediaPickerStore';
import { openAndroidLibrary } from '../../lib/media/pickMedia';
import { applyFeatureCrop } from '../../lib/media/imageOps';
import type { PickMediaRequest, PickedMedia } from '../../lib/media/types';
import { AndroidCameraScreen } from './AndroidCameraScreen';
import { AndroidPreviewScreen } from './AndroidPreviewScreen';
import { CameraPermissionScreen } from './CameraPermissionScreen';
import { PhotoSourceSheet } from './PhotoSourceSheet';
import { mediaColors } from './mediaTheme';

type Stage =
  | { kind: 'closed' }
  // Take Photo / Photo Library chooser, for source:'choose' requests.
  | { kind: 'choose' }
  | { kind: 'permission'; variant: 'explain' | 'blocked' }
  | { kind: 'camera' }
  | { kind: 'preview'; picked: PickedMedia; mode: 'camera' | 'library' };

/**
 * The ONE place an Android camera or photo preview can render.
 *
 * Mounted once in the root layout, like SidebarHost and LeaveClubHost. Every
 * Android image entry point — profile picture, post, chat attachment, club
 * avatar, club banner, event image — raises its request through pickMedia()
 * and lands here, so there is exactly one camera implementation in the app and
 * no screen can be left behind on the OEM camera.
 *
 * On iOS this renders nothing at all: callers keep their existing
 * expo-image-picker paths, untouched.
 */
export function MediaPickerHost() {
  const request = useMediaPickerStore((s) => s.request);
  const setRequest = useMediaPickerStore((s) => s.setRequest);

  const [stage, setStage] = useState<Stage>({ kind: 'closed' });

  // Resolve exactly once per request. Without this, Back-during-an-await or a
  // late library result could settle a promise the user already cancelled —
  // which is how a feature ends up with an image it was never handed.
  const settledFor = useRef<number | null>(null);
  const activeId = useRef<number | null>(null);

  const finish = useCallback(
    (result: PickedMedia | null) => {
      const current = useMediaPickerStore.getState().request;
      if (!current || settledFor.current === current.id) return;
      settledFor.current = current.id;
      activeId.current = null;
      setStage({ kind: 'closed' });
      setRequest(null);
      current.resolve(result);
    },
    [setRequest],
  );

  /** True while `id` is still the request the user is actually in. */
  const stillCurrent = (id: number) => activeId.current === id;

  const openLibrary = useCallback(
    async (id: number, options: PickMediaRequest, onCancelled: () => void) => {
      let picked: PickedMedia | null = null;
      try {
        picked = await openAndroidLibrary(options);
      } catch {
        // The picker failed to open at all. Treat as a cancel rather than
        // stranding the user on a blank screen.
        picked = null;
      }
      if (!stillCurrent(id)) return;

      if (!picked) {
        onCancelled();
        return;
      }

      // Video is chat-only and keeps its existing path: it goes straight back
      // to the attachment pipeline without an image preview, so this change
      // cannot regress video sending.
      if (picked.kind === 'video') {
        finish(picked);
        return;
      }

      setStage({ kind: 'preview', picked, mode: 'library' });
    },
    [finish],
  );

  const ensureCameraPermission = useCallback(async (id: number) => {
    let status = await Camera.getCameraPermissionsAsync();

    // State 1 — never asked: show the real Android system dialog. This is the
    // only place camera permission is ever requested, and it is reached only
    // because the user just tapped Camera.
    if (!status.granted && status.canAskAgain) {
      status = await Camera.requestCameraPermissionsAsync();
    }
    if (!stillCurrent(id)) return;

    if (status.granted) {
      setStage({ kind: 'camera' });
    } else {
      // State 3 vs 4 — refusable again, or only reversible in Settings.
      setStage({ kind: 'permission', variant: status.canAskAgain ? 'explain' : 'blocked' });
    }
  }, []);

  // Drive a new request. Camera goes through the permission gate; library goes
  // straight to the OS photo picker with no modal behind it, so a cancelled
  // pick never flashes an empty screen.
  useEffect(() => {
    if (!request) return;
    if (activeId.current === request.id) return;

    activeId.current = request.id;
    settledFor.current = null;

    if (request.options.source === 'choose') {
      // Screens with a single "change image" tap and no source buttons of their
      // own: ask camera-vs-library first. Back / backdrop here cancels cleanly.
      setStage({ kind: 'choose' });
    } else if (request.options.source === 'camera') {
      void ensureCameraPermission(request.id);
    } else {
      void openLibrary(request.id, request.options, () => finish(null));
    }
  }, [request, ensureCameraPermission, openLibrary, finish]);

  // Chooser selections. Library reuses the same options (ratio/crop preserved);
  // cancelling the picker from here returns to the chooser, not out of the flow.
  const chooseCamera = useCallback(() => {
    const id = activeId.current;
    if (id != null) void ensureCameraPermission(id);
  }, [ensureCameraPermission]);

  const chooseLibrary = useCallback(() => {
    const id = activeId.current;
    const options = useMediaPickerStore.getState().request?.options;
    if (id == null || !options) return;
    void openLibrary(id, options, () => setStage({ kind: 'choose' }));
  }, [openLibrary]);

  const handleUse = useCallback(async () => {
    if (stage.kind !== 'preview') return;
    const current = useMediaPickerStore.getState().request;
    if (!current) return;

    // Applied to both sources, and only now — after the user confirmed the
    // framing this screen showed them. A library image the OS crop step already
    // squared off is returned untouched (applyFeatureCrop no-ops when the ratio
    // already matches), so this costs an encode only when it actually changes
    // the picture, and the two sources can never disagree about the final ratio.
    const result = await applyFeatureCrop(stage.picked, current.options.aspect);

    finish(result);
  }, [stage, finish]);

  const handleRedo = useCallback(() => {
    if (stage.kind !== 'preview') return;
    const id = activeId.current;
    const options = useMediaPickerStore.getState().request?.options;
    if (id == null || !options) return;

    if (stage.mode === 'camera') {
      setStage({ kind: 'camera' });
    } else {
      // Choose Another — reopen the system picker. Cancelling it keeps the
      // photo already on screen rather than dumping the user out of the flow.
      void openLibrary(id, options, () => {});
    }
  }, [stage, openLibrary]);

  /** Android hardware / gesture Back. */
  const handleBack = useCallback(() => {
    if (stage.kind === 'preview' && stage.mode === 'camera') {
      // Back from a capture returns to the live camera, not out of the flow.
      setStage({ kind: 'camera' });
      return;
    }
    // Chooser, live camera, gallery preview and the permission screens all
    // cancel back to the calling feature, leaving its image untouched.
    finish(null);
  }, [stage, finish]);

  const handleOpenLibraryFromCamera = useCallback(() => {
    const id = activeId.current;
    const options = useMediaPickerStore.getState().request?.options;
    if (id == null || !options) return;
    // The camera's roll shortcut lands in the same place the feature's own
    // Photo Library button would: same ratio, same OS crop step.
    const libraryOptions: PickMediaRequest = {
      ...options,
      source: 'library',
      allowsEditing: options.allowsEditing ?? !!options.aspect,
    };
    // Cancelling the picker returns to the camera the user was already in.
    void openLibrary(id, libraryOptions, () => setStage({ kind: 'camera' }));
  }, [openLibrary]);

  // iOS never mounts any of this.
  if (Platform.OS !== 'android') return null;

  const visible = stage.kind !== 'closed';
  const aspect = request?.options.aspect;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={handleBack}
      // Edge-to-edge so useSafeAreaInsets describes the real status bar and
      // gesture/3-button navigation bar. Without these the modal window is
      // pre-inset and the controls would be padded twice.
      statusBarTranslucent
      navigationBarTranslucent
      // Transparent so the chooser reads as a bottom sheet over the dimmed app.
      // The camera / preview / permission stages each paint their own opaque
      // full-screen background, so they still look identical.
      transparent
    >
      <View style={stage.kind === 'choose' ? styles.transparentRoot : styles.root}>
        {/* The camera is black; the app's normal dark status-bar text would be
            invisible on it. The chooser sits over the app, so it keeps the
            app's own status-bar styling. */}
        {stage.kind !== 'choose' ? (
          <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        ) : null}

        {stage.kind === 'choose' ? (
          <PhotoSourceSheet
            onCamera={chooseCamera}
            onLibrary={chooseLibrary}
            onCancel={() => finish(null)}
          />
        ) : null}

        {stage.kind === 'camera' ? (
          <AndroidCameraScreen
            aspect={aspect}
            onCancel={() => finish(null)}
            onCaptured={(picked) => setStage({ kind: 'preview', picked, mode: 'camera' })}
            onOpenLibrary={handleOpenLibraryFromCamera}
          />
        ) : null}

        {stage.kind === 'preview' ? (
          <AndroidPreviewScreen
            picked={stage.picked}
            mode={stage.mode}
            aspect={aspect}
            onCancel={() => finish(null)}
            onRedo={handleRedo}
            onUse={() => void handleUse()}
          />
        ) : null}

        {stage.kind === 'permission' ? (
          <CameraPermissionScreen
            variant={stage.variant}
            onRetry={() => {
              const id = activeId.current;
              if (id != null) void ensureCameraPermission(id);
            }}
            onCancel={() => finish(null)}
            onReturnFromSettings={() => {
              const id = activeId.current;
              if (id != null) void ensureCameraPermission(id);
            }}
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: mediaColors.dark },
  // Chooser stage: let the dimmed app show through the transparent modal.
  transparentRoot: { flex: 1, backgroundColor: 'transparent' },
});
