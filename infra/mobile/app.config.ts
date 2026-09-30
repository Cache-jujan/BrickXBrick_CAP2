import type { ExpoConfig } from "expo/config";

// Static bundle identifier and deep-link scheme.
// NOTE: scheme must match the redirect URI configured in your OAuth
// provider (Supabase) — update that dashboard setting to
// "brickxbrick://oauth/callback" if it isn't already.
const bundleId = "com.app.receiptcapturemobile";
const scheme = "brickxbrick";

const env = {
  appName: "BrickXBrick",
  appSlug: "receipt-capture-mobile",
  scheme,
  iosBundleId: bundleId,
  androidPackage: bundleId,
};

const config: ExpoConfig = {
  name: env.appName,
  slug: env.appSlug,
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
      backgroundColor: "#F8F1E8",
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundImage: "./assets/adaptive-icon.png",
      monochromeImage: "./assets/adaptive-icon.png",
    },
    predictiveBackGestureEnabled: false,
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
};

export default config;