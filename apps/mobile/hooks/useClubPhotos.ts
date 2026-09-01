import { useQuery } from '@tanstack/react-query';
import { getClubPhotos, type ClubPhoto } from '../services/clubService';
import { getPostsByIds, type FeedPost } from '../services/postService';
import { timedQuery } from '../lib/timedQuery';

// THE single source of truth for every Photos that Glue surface:
// club profile preview, Edit Club, the See-all grid, and the full viewer all
// read this feed (or the same underlying getClubPhotos query), so they can
// never disagree about which photos exist, their order (newest first), or
// hidden/deleted state.

export interface ClubPhotoFeedItem {
  photo: ClubPhoto;
  /** Present for tagged posts that still exist; officer uploads have none. */
  post: FeedPost | null;
}

export function useClubPhotoFeed(
  clubId: string | undefined,
  viewerUserId: string | undefined,
) {
  return useQuery<ClubPhotoFeedItem[]>({
    queryKey: ['clubPhotoFeed', clubId, viewerUserId],
    queryFn: () =>
      timedQuery('clubPhotoFeed', buildClubPhotoFeed(clubId!, viewerUserId!)),
    enabled: !!clubId && !!viewerUserId,
    staleTime: 60 * 1000,
  });
}

async function buildClubPhotoFeed(
  clubId: string,
  viewerUserId: string,
): Promise<ClubPhotoFeedItem[]> {
  const photos = await getClubPhotos(clubId);
  // Both tagged-post AND club-authored photos are backed by a real post the
  // viewer opens on — an officer upload is the only source with no post.
  const postIds = photos
    .filter((p) => (p.source === 'tagged_post' || p.source === 'club_authored') && p.post_id)
    .map((p) => p.post_id!) as string[];

  const postsById = await getPostsByIds(viewerUserId, postIds);

  // A post-backed photo whose post has vanished since the photo query ran is
  // dropped — the viewer never renders a broken/imageless post block.
  return photos
    .map((photo) => ({
      photo,
      post: photo.post_id ? postsById.get(photo.post_id) ?? null : null,
    }))
    .filter((item) => item.photo.source === 'officer_upload' || item.post !== null);
}
