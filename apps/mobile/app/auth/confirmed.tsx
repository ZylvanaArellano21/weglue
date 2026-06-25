import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../components/Toast";

export default function AuthConfirmedScreen() {
  const router = useRouter();
  const { show, ToastComponent } = useToast();

  useEffect(() => {
    async function handleConfirmed() {
      const url = await Linking.getInitialURL();

      // Step 1: establish a session from the tokens in the deep link hash
      if (url) {
        const fragment = url.split("#")[1] ?? "";
        const params = new URLSearchParams(fragment);
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");

        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (error) {
            show("Session could not be restored. Please log in.", "error");
            router.replace("/auth/login");
            return;
          }
        }
      }

      // Step 2: confirm a valid session exists
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;

      if (!session?.user?.email_confirmed_at) {
        show("Email confirmed! Please log in to continue.", "success");
        router.replace("/auth/login");
        return;
      }

      // Step 3: check the profile — avatar_url determines how far along the user is
      const { data: profile } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", session.user.id)
        .single();

      if (!profile?.avatar_url) {
        // Email confirmed but profile not yet complete → Profile Picture screen
        router.replace("/onboarding/profile-pic");
      } else {
        // Fully set up — go straight to Club Catalog
        router.replace("/(tabs)/home");
      }
    }

    handleConfirmed();
  }, []);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#FEFCF0",
      }}
    >
      {ToastComponent}
      <ActivityIndicator size="large" color="#0FA6A6" />
    </View>
  );
}
