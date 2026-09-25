import { Redirect, Stack } from "expo-router";

import { getSession } from "@/lib/auth";

export default function ExpenseFlowLayout() {
  const session = getSession();
  if (!session || session.user.role !== "Purchaser") return <Redirect href="/login" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
