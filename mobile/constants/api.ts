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

/** Use the configured API URL or a development host; throw if a release has no API URL. */
function resolveApiUrl() {
  if (configuredApiUrl) return configuredApiUrl;
  if (__DEV__) return getLocalApiUrl();
  // A release build must never ship pointing at a placeholder.
  throw new Error("EXPO_PUBLIC_API_URL is not set. Set it before building a release.");
}

export const API_URL = resolveApiUrl();

// The token must come only from the current login session.
// Do not use EXPO_PUBLIC_DEV_TOKEN here.
let activeToken = "";

export function setAuthToken(token: string) {
  activeToken = token;
}

export function getAuthToken() {
  return activeToken;
}

export function authHeaders() {
  return {
    Authorization: `Bearer ${activeToken}`,
  };
}
