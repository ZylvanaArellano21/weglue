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
            const { data: interests } = await supabase
              .from("user_interests")
              .select("id")
              .eq("user_id", user.id)
              .limit(1);

            if ((interests?.length ?? 0) > 0) {
              router.replace("/(tabs)/home");
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
