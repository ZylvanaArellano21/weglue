import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { supabase } from "../../lib/supabase";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    async function handleDeepLink() {
      const url = await Linking.getInitialURL();
      if (!url) {
        router.replace("/");
        return;
      }

      // Supabase sends tokens in the URL fragment after email verification
      // e.g. weglue://auth/callback#access_token=...&refresh_token=...
      const fragment = url.split("#")[1] ?? "";
      const params = new URLSearchParams(fragment);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");

      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });

        if (!error) {
          const {
            data: { user },
          } = await supabase.auth.getUser();

          if (user) {
            // Route on onboarding progress (avatar_url), never on interests —
            // a confirmed user must never be dropped back into the survey.
            const { data: profile } = await supabase
              .from("profiles")
              .select("avatar_url")
              .eq("id", user.id)
              .single();

            if (profile?.avatar_url) {
              router.replace("/(tabs)");
            } else {
              // They just verified — continue onboarding from profile pic
              router.replace("/onboarding/profile-pic");
            }
            return;
          }
        }
      }

      // Fallback: send to login
      router.replace("/auth/login");
    }

    handleDeepLink();
  }, []);

  return (
    <View
      style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FEFCF0" }}
    >
      <ActivityIndicator size="large" color="#0FA6A6" />
    </View>
  );
}
