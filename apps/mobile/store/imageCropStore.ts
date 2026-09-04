import { create } from 'zustand';
import type { CropAspectOption, CropResult } from '../components/media/ImageCropper';

// One app-wide crop request at a time, resolved by the single ImageCropHost
// mounted in the root layout. Same shape as leaveClubStore / mediaPickerStore.
//
// This is the CROSS-PLATFORM path: the Android media flow reaches it through
// MediaPickerHost, and iOS callers reach it directly after the OS picker,
// so every "frame this image into a ratio" step is the same in-app cropper.

export interface CropRequestInput {
  uri: string;
  sourceWidth: number;
  sourceHeight: number;
  aspect: [number, number];
  /** Post compose only: show the Original / 1:1 / 4:5 ratio picker. */
  aspectOptions?: CropAspectOption[];
}

interface PendingCropRequest extends CropRequestInput {
  id: number;
  resolve: (result: CropResult | null) => void;
}

interface ImageCropState {
  request: PendingCropRequest | null;
  setRequest: (request: PendingCropRequest | null) => void;
}

export const useImageCropStore = create<ImageCropState>((set) => ({
  request: null,
  setRequest: (request) => set({ request }),
}));

let nextId = 1;

/**
 * Opens the in-app cropper and resolves with the cropped image, or null if the
 * user cancelled. A request raised while another is live resolves null.
 */
export function requestCrop(input: CropRequestInput): Promise<CropResult | null> {
  const { request: active, setRequest } = useImageCropStore.getState();
  if (active) return Promise.resolve(null);
  return new Promise<CropResult | null>((resolve) => {
    setRequest({ ...input, id: nextId++, resolve });
  });
}
