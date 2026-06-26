import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "@weglue/shared";

const INTERESTS = [
  "Finance & Business",
  "Social Events",
  "Music",
  "Fashion",
  "Art & Culture",
  "Social Justice & Activism",
  "Numbers & Economics",
  "Gaming",
  "Health & Wellness",
  "Environment",
  "Sports & Athletics",
  "Community Service",
  "Crafts",
  "Religion",
  "Technology and Computer",
  "Film & Media",
  "Photography",
  "Strategy and Critical Thinking",
  "Writing",
  "Theater",
  "Travel & Languages",
  "Debate & Politics",
] as const;

const ACTIVITIES = [
  "Projects",
  "Volunteering",
  "Workshops",
  "Campus Fairs",
  "Trips",
  "Study Groups",
  "Networking",
  "Tournaments",
  "Social Events",
  "Campus Tours",
] as const;

export default function SurveyScreen() {
  const router = useRouter();
  const { user, setOnboarded } = useAuthStore();
  const [step, setStep] = useState(1);
  const [selectedInterests, setSelectedInterests] = useState<Set<string>>(new Set());
  const [selectedActivities, setSelectedActivities] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  function toggleInterest(item: string) {
    setSelectedInterests((prev) => {
      const next = new Set(prev);
      next.has(item) ? next.delete(item) : next.add(item);
      return next;
    });
  }

  function toggleActivity(item: string) {
    setSelectedActivities((prev) => {
      const next = new Set(prev);
      next.has(item) ? next.delete(item) : next.add(item);
      return next;
    });
  }

  async function handleSave() {
    if (!user) return;
    setLoading(true);

    const interestRows = Array.from(selectedInterests).map((interest) => ({
      user_id: user.id,
      interest,
    }));
    const activityRows = Array.from(selectedActivities).map((activity) => ({
      user_id: user.id,
      activity,
    }));

    await Promise.all([
      interestRows.length > 0
        ? supabase.from("user_interests").insert(interestRows)
        : Promise.resolve(),
      activityRows.length > 0
        ? supabase.from("user_activities").insert(activityRows)
        : Promise.resolve(),
      supabase.from("user_privacy").upsert({
        user_id: user.id,
        is_private: false,
        hide_interests: false,
        hide_events: false,
      }),
    ]);

    setOnboarded(true);
    setLoading(false);
    router.replace("/(tabs)");
  }

  return (
    <SafeAreaView className="flex-1 bg-cream">
      {/* Top bar */}
      <View className="px-6 pt-4 flex-row items-center justify-between">
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-teal text-base">Cancel</Text>
        </TouchableOpacity>
        <Text
          className="text-teal text-xl"
          style={{ fontFamily: "Zain_700Bold" }}
        >
          Survey
        </Text>
        <View className="w-12" />
      </View>

      {/* Progress bar */}
      <View className="mx-6 mt-4 mb-2 h-2 bg-gray-200 rounded-full overflow-hidden">
        <View
          className="h-full bg-teal rounded-full"
          style={{ width: step === 1 ? "50%" : "100%" }}
        />
      </View>
      <Text className="text-center text-gray-500 text-sm mb-6">
        Step {step} of 2
      </Text>

      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="px-6 pb-32">
          {step === 1 ? (
            <>
              <Text
                className="text-2xl text-teal mb-2"
                style={{ fontFamily: "Zain_700Bold" }}
              >
                What are your interests?
              </Text>
              <Text className="text-sm text-gray-500 mb-6">
                Select everything that excites you. We will match you to clubs
                that fit.
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {INTERESTS.map((item) => {
                  const selected = selectedInterests.has(item);
                  return (
                    <TouchableOpacity
                      key={item}
                      onPress={() => toggleInterest(item)}
                      className={`px-4 py-2 rounded-full border ${
                        selected
                          ? "bg-teal border-teal"
                          : "bg-white border-gray-200"
                      }`}
                    >
                      <Text
                        className={`text-sm ${
                          selected ? "text-white" : "text-gray-700"
                        }`}
                      >
                        {item}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : (
            <>
              <Text
                className="text-2xl text-teal mb-2"
                style={{ fontFamily: "Zain_700Bold" }}
              >
                What do you enjoy doing?
              </Text>
              <Text className="text-sm text-gray-500 mb-6">
                Pick all the activities you love. This helps us personalize your
                feed.
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {ACTIVITIES.map((item) => {
                  const selected = selectedActivities.has(item);
                  return (
                    <TouchableOpacity
                      key={item}
                      onPress={() => toggleActivity(item)}
                      className={`px-4 py-2 rounded-full border ${
                        selected
                          ? "bg-teal border-teal"
                          : "bg-white border-gray-200"
                      }`}
                    >
                      <Text
                        className={`text-sm ${
                          selected ? "text-white" : "text-gray-700"
                        }`}
                      >
                        {item}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {/* Floating bottom button */}
      <View className="absolute bottom-0 left-0 right-0 px-6 pb-10 pt-4 bg-cream">
        {step === 1 ? (
          <TouchableOpacity
            onPress={() => setStep(2)}
            className="bg-teal rounded-full py-4 items-center self-end px-8"
          >
            <Text
              className="text-white text-lg"
              style={{ fontFamily: "Zain_700Bold" }}
            >
              Next
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleSave}
            disabled={loading}
            className="bg-teal rounded-full py-4 items-center self-end px-8"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text
                className="text-white text-lg"
                style={{ fontFamily: "Zain_700Bold" }}
              >
                Save
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}
