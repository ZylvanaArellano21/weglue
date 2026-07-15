import { create } from 'zustand';
import type { PickMediaRequest, PickedMedia } from '../lib/media/types';

// One app-wide media-selection request at a time.
//
// Same shape as leaveClubStore: every Android image entry point raises a
// request through pickMedia() (lib/media/pickMedia.ts) and the single
// MediaPickerHost — mounted once in the root layout — owns the camera, the
// preview and the permission UI.
//
// Because there is exactly ONE host and ONE request slot, the whole class of
// bugs this task lists (duplicate camera screens, duplicate previews, two
// stacked modals, duplicate uploads from a double tap) is structurally
// impossible rather than defended against per screen: a second request while
// one is live resolves null immediately instead of mounting anything.

export interface PendingMediaRequest {
  /** Monotonic id — lets the host ignore results from a superseded request. */
  id: number;
  options: PickMediaRequest;
  resolve: (result: PickedMedia | null) => void;
}

interface MediaPickerState {
  request: PendingMediaRequest | null;
  setRequest: (request: PendingMediaRequest | null) => void;
}

export const useMediaPickerStore = create<MediaPickerState>((set) => ({
  request: null,
  setRequest: (request) => set({ request }),
}));

let nextId = 1;

/**
 * Opens the shared Android media flow and resolves with the confirmed image,
 * or null if the user cancelled at any stage.
 *
 * A request raised while another is still live resolves null — that is the
 * rapid-double-tap guard, and it is why no caller needs its own.
 */
export function requestMedia(options: PickMediaRequest): Promise<PickedMedia | null> {
  const { request: active, setRequest } = useMediaPickerStore.getState();
  if (active) return Promise.resolve(null);

  return new Promise<PickedMedia | null>((resolve) => {
    setRequest({ id: nextId++, options, resolve });
  });
}
