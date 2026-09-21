import Constants from "expo-constants";

function getLocalApiUrl() {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    Constants.manifest2?.extra?.expoGo?.debuggerHost;

  const host = hostUri?.split(":")[0];

  if (!host) {
    throw new Error("Could not determine local development server IP.");
  }

  return `http://${host}:3000`;
}

export const API_URL = __DEV__
  ? getLocalApiUrl()
  : "https://YOUR-RAILWAY-BACKEND-URL";

export const DEV_TOKEN = process.env.EXPO_PUBLIC_DEV_TOKEN ?? "";

export function authHeaders() {
  return { Authorization: `Bearer ${DEV_TOKEN}` };
}