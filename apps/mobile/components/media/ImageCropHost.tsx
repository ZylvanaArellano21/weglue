import { useCallback, useRef } from 'react';
import { Modal, View, StyleSheet } from 'react-native';
import { useImageCropStore } from '../../store/imageCropStore';
import { ImageCropper, type CropResult } from './ImageCropper';
import { mediaColors } from './mediaTheme';

/**
 * The ONE place the in-app crop / zoom / reposition step renders — mounted once
 * in the root layout, cross-platform (iOS + Android). Every "frame this image
 * into a ratio" flow (profile picture, club banner, event image, each photo of
 * a carousel) raises a request through `requestCrop()` and lands here.
 */
export function ImageCropHost() {
  const request = useImageCropStore((s) => s.request);
  const setRequest = useImageCropStore((s) => s.setRequest);
  const settledFor = useRef<number | null>(null);

  const finish = useCallback(
    (result: CropResult | null) => {
      const current = useImageCropStore.getState().request;
      if (!current || settledFor.current === current.id) return;
      settledFor.current = current.id;
      setRequest(null);
      current.resolve(result);
    },
    [setRequest],
  );

  return (
    <Modal
      visible={!!request}
      animationType="fade"
      onRequestClose={() => finish(null)}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.root}>
        {request ? (
          <ImageCropper
            key={request.id}
            uri={request.uri}
            sourceWidth={request.sourceWidth}
            sourceHeight={request.sourceHeight}
            aspect={request.aspect}
            onCancel={() => finish(null)}
            onConfirm={(result) => finish(result)}
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: mediaColors.dark },
});
