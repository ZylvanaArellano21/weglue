import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import type { FeedPost } from '../../services/postService';
import type { EventDetail } from '../../services/eventService';

export type StoryCaptureRequest =
  | { kind: 'post'; post: FeedPost }
  | { kind: 'event'; event: EventDetail };

/**
 * Orchestrates producing the Instagram Story background image: mounts the
 * matching off-screen StoryCard (see components/share/StoryCard.tsx),
 * waits for its images to settle, then captures it to a local PNG file via
 * react-native-view-shot. This is a real render of live We Glue data, not a
 * screenshot of whatever the user's screen happens to show.
 *
 * One instance is meant to be mounted once (at the /share route) and its
 * `capture()` function handed down to whatever triggers a Story share.
 */
export function useStoryImageCapture() {
  const [request, setRequest] = useState<StoryCaptureRequest | null>(null);
  const viewRef = useRef<View>(null);
  const resolverRef = useRef<((uri: string | null) => void) | null>(null);

  const onReady = useCallback(async () => {
    try {
      const uri = await captureRef(viewRef, { format: 'png', quality: 1, result: 'tmpfile' });
      resolverRef.current?.(uri);
    } catch {
      resolverRef.current?.(null);
    } finally {
      resolverRef.current = null;
      setRequest(null);
    }
  }, []);

  /** Resolves the local file:// URI, or null if rendering/capture failed —
   *  callers must treat null as a clean failure, never throw onward. */
  const capture = useCallback((next: StoryCaptureRequest): Promise<string | null> => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setRequest(next);
    });
  }, []);

  return { capture, request, viewRef, onReady };
}
