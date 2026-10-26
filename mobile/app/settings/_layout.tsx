import { Redirect, Stack } from "expo-router";

import { getSession } from "@/lib/auth";

export default function SettingsLayout() {
  if (!getSession()) return <Redirect href="/login" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
