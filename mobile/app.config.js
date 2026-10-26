// Plain JavaScript on purpose: EAS CLI and older Node versions read this file
// without a TypeScript step, and TypeScript syntax here ("import type", ": Type")
// makes `eas init` / `eas build` fail with "Unexpected token '{'".

// Static bundle identifier and deep-link scheme.
// NOTE: scheme must match the redirect URI configured in your OAuth
// provider (Supabase) — update that dashboard setting to
// "brickxbrick://oauth/callback" if it isn't already.
const bundleId = "com.fourloop.brickxbrick";
const scheme = "brickxbrick";

const env = {
  appName: "BrickXBrick",
  appSlug: "receipt-capture-mobile",
  scheme,
  iosBundleId: bundleId,
  androidPackage: bundleId,
};

// A release build blocks plain http:// by default. Only allow it when the
// backend address really is http (a LAN or test server); an https:// backend
// (the deployed one) keeps the safer default.
const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() ?? "";
const allowCleartext = apiUrl.startsWith("http://");

/** @type {import("expo/config").ExpoConfig} */
const config = {
  name: env.appName,
  slug: env.appSlug,
  owner: "cache-jujan",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: env.scheme,
  userInterfaceStyle: "light",
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.iosBundleId,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#BF4307",
      foregroundImage: "./assets/adaptive-icon.png",
      monochromeImage: "./assets/adaptive-icon.png",
    },
    predictiveBackGestureEnabled: false,
    // The Expo default, written down on purpose. The keyboard wrapper in
    // components/keyboard-avoider.tsx measures what the keyboard really covers,
    // so it works with this mode and with edge-to-edge.
    softwareKeyboardLayoutMode: "resize",
    package: env.androidPackage,
    permissions: ["POST_NOTIFICATIONS"],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: env.scheme,
            host: "*",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-asset",
    "expo-font",
    "expo-status-bar",
    "expo-router",
    "expo-sqlite",
    [
      "expo-audio",
      {
        microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone.",
      },
    ],
    [
      "expo-video",
      {
        supportsBackgroundPlayback: true,
        supportsPictureInPicture: true,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#F8F1E8",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
          usesCleartextTraffic: allowCleartext,
        },
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Allow $(PRODUCT_NAME) to access your photos to attach receipts.",
        cameraPermission: "Allow $(PRODUCT_NAME) to access your camera to capture receipts.",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    eas: {
      projectId: "ecca3f5b-5be2-440f-b12c-0d9a12581a46",
    },
  },
};

module.exports = config;