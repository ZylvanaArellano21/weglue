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

      if (url) {
        // Extract tokens from hash fragment: weglue://auth/confirmed#access_token=...&refresh_token=...
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
            router.replace("/onboarding/profile-pic");
            return;
          }
        }
      }

      // Fallback: check if a session already exists (e.g., polling caught it first)
      const { data } = await supabase.auth.getSession();
      if (data.session?.user?.email_confirmed_at) {
        router.replace("/onboarding/profile-pic");
        return;
      }

      // No valid session — send to login with a message
      show("Email confirmed! Please log in to continue.", "success");
      router.replace("/auth/login");
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
