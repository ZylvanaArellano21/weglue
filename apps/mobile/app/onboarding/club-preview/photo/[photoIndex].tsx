import {
  Dimensions,
  Image,
  StyleSheet,
  TouchableOpacity,
  View,
  Text,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { MOCK_CLUBS } from "../../../../data/mockClubs";

const { width, height } = Dimensions.get("window");

export default function PhotoPreviewScreen() {
  const router = useRouter();
  const { photoIndex, clubId } = useLocalSearchParams<{
    photoIndex: string;
    clubId: string;
  }>();

  const club = MOCK_CLUBS.find((c) => c.id === clubId) ?? MOCK_CLUBS[0];
  const index = Math.max(0, Math.min(parseInt(photoIndex ?? "0", 10), club.photos.length - 1));
  const photoUrl = club.photos[index];

  return (
    <View style={styles.root}>
      {/* Close button */}
      <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
        <Text style={styles.closeText}>✕</Text>
      </TouchableOpacity>

      <Image
        source={{ uri: photoUrl }}
        style={styles.photo}
        resizeMode="contain"
      />

      {/* Dot indicator */}
      <View style={styles.dotsRow}>
        {club.photos.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === index && styles.dotActive]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtn: {
    position: "absolute",
    top: 56,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  closeText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  photo: { width, height: height * 0.75 },
  dotsRow: {
    position: "absolute",
    bottom: 48,
    flexDirection: "row",
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  dotActive: { backgroundColor: "#fff" },
});
