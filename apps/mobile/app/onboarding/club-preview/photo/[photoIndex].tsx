import {
  Dimensions,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { MOCK_CLUBS } from "../../../../data/mockClubs";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface MockPost {
  id: string;
  imageUrl: string;
  likes: number;
  comments: number;
  shares: number;
  username: string;
  caption: string;
  timestamp: string;
  avatarUrl: string;
  clubTag: string;
  isFollowing: boolean;
}

export default function PhotoPreviewScreen() {
  const router = useRouter();
  const { photoIndex, clubId } = useLocalSearchParams<{
    photoIndex: string;
    clubId: string;
  }>();

  const club = MOCK_CLUBS.find((c) => c.id === clubId) ?? MOCK_CLUBS[0];

  const posts: MockPost[] = [
    {
      id: "p1",
      imageUrl: club.photos[0],
      likes: 34,
      comments: 40,
      shares: 1,
      username: "@jordancruz",
      caption: "Having a great time with my friends.",
      timestamp: "3 hours ago",
      avatarUrl: "https://picsum.photos/seed/post-user1/60/60",
      clubTag: club.name,
      isFollowing: true,
    },
    {
      id: "p2",
      imageUrl: club.photos[1] ?? club.photos[0],
      likes: 34,
      comments: 40,
      shares: 1,
      username: "@jordancruz",
      caption: "Having a great time with my friends.",
      timestamp: "3 hours ago",
      avatarUrl: "https://picsum.photos/seed/post-user1/60/60",
      clubTag: club.name,
      isFollowing: true,
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Text style={styles.backArrow}>‹</Text>
      </TouchableOpacity>

      <ScrollView showsVerticalScrollIndicator={false}>
        {posts.map((post) => (
          <View key={post.id} style={styles.postCard}>
            {/* Post image */}
            <Image
              source={{ uri: post.imageUrl }}
              style={styles.postImage}
              resizeMode="cover"
            />

            {/* Like / comment / share row */}
            <View style={styles.actionsRow}>
              <View style={styles.actionItem}>
                <Text style={styles.actionIcon}>♡</Text>
                <Text style={styles.actionCount}>{post.likes}</Text>
              </View>
              <View style={styles.actionItem}>
                <Text style={styles.actionIcon}>💬</Text>
                <Text style={styles.actionCount}>{post.comments}</Text>
              </View>
              <View style={styles.actionItem}>
                <Text style={styles.actionIcon}>↗</Text>
                <Text style={styles.actionCount}>{post.shares}</Text>
              </View>
            </View>

            {/* Caption */}
            <Text style={styles.caption}>
              <Text style={styles.captionUsername}>{post.username} </Text>
              {post.caption}
            </Text>
            <Text style={styles.timestamp}>{post.timestamp}</Text>

            {/* Divider */}
            <View style={styles.divider} />

            {/* User row */}
            <View style={styles.userRow}>
              <Image source={{ uri: post.avatarUrl }} style={styles.userAvatar} />
              <View style={styles.userInfo}>
                <Text style={styles.userUsername}>{post.username}</Text>
                <Text style={styles.userClubTag}>
                  tag{" "}
                  <Text style={styles.clubTagHighlight}>{post.clubTag}</Text>
                </Text>
              </View>
              <TouchableOpacity style={styles.followingPill} activeOpacity={0.85}>
                <Text style={styles.followingPillText}>Following</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const TEAL = "#0FA6A6";
const CREAM = "#FEFCF0";
const INK = "#1a1a1a";
const MUTED = "#5F5D5D";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CREAM },
  backBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignSelf: "flex-start",
  },
  backArrow: { fontSize: 30, color: INK, lineHeight: 36 },
  postCard: {
    backgroundColor: "#fff",
    marginBottom: 8,
  },
  postImage: {
    width: SCREEN_WIDTH,
    height: 260,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  actionIcon: { fontSize: 18, color: INK },
  actionCount: { fontSize: 13, color: INK, fontWeight: "500" },
  caption: {
    fontSize: 13,
    color: INK,
    lineHeight: 18,
    paddingHorizontal: 14,
    marginBottom: 4,
  },
  captionUsername: { fontWeight: "700" },
  timestamp: {
    fontSize: 11,
    color: MUTED,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(0,0,0,0.07)",
    marginHorizontal: 14,
    marginBottom: 10,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 10,
  },
  userAvatar: { width: 36, height: 36, borderRadius: 18 },
  userInfo: { flex: 1 },
  userUsername: { fontSize: 13, fontWeight: "700", color: INK },
  userClubTag: { fontSize: 12, color: MUTED, marginTop: 1 },
  clubTagHighlight: { color: TEAL, fontWeight: "600" },
  followingPill: {
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.2)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  followingPillText: { fontSize: 11, color: MUTED, fontWeight: "500" },
});
