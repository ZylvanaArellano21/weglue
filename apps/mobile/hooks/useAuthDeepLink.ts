import { useEffect } from "react";
import * as Linking from "expo-linking";
import { supabase } from "../lib/supabase";

async function handleUrl(url: string) {
  if (!url.includes("auth/confirmed")) return;

  const fragment = url.split("#")[1] ?? "";
  const params = new URLSearchParams(fragment);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");

  if (access_token && refresh_token) {
    await supabase.auth.setSession({ access_token, refresh_token });
    // onAuthStateChange in _layout.tsx fires automatically after setSession
  }
}

export function useAuthDeepLink() {
  useEffect(() => {
    // Cold start: app launched from the deep link
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    // Warm start: app already running, brought to foreground via deep link
    const subscription = Linking.addEventListener("url", ({ url }) =>
      handleUrl(url)
    );

    return () => subscription.remove();
  }, []);
}
