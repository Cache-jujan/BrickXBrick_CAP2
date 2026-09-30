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

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

export const API_URL = configuredApiUrl || (__DEV__
  ? getLocalApiUrl()
  : "https://YOUR-RAILWAY-BACKEND-URL");

export const DEV_TOKEN = process.env.EXPO_PUBLIC_DEV_TOKEN ?? "";
let activeToken = DEV_TOKEN;

export function setAuthToken(token: string) {
  activeToken = token;
}

export function getAuthToken() {
  return activeToken;
}

export function authHeaders() {
  return { Authorization: `Bearer ${activeToken}` };
}
