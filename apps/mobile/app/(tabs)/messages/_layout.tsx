import { Stack } from 'expo-router';

export default function MessagesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="add-people" />
      <Stack.Screen name="[chatId]/index" />
      <Stack.Screen name="[chatId]/[channelId]" />
      <Stack.Screen name="[chatId]/info" />
      <Stack.Screen name="[chatId]/search" />
    </Stack>
  );
}
