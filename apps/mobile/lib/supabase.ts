import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// Expo injects EXPO_PUBLIC_* env vars at build time via Metro
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error – process.env is replaced by Metro bundler
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
