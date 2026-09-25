import { Redirect } from "expo-router";

import { getSession } from "@/lib/auth";

export default function IndexScreen() {
  const session = getSession();
  if (!session) return <Redirect href="/login" />;
  return <Redirect href={session.user.role === "Site Manager" ? "/site-manager" : "/(tabs)"} />;
}
