const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// The web and mobile clients ship the same offline language catalog.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../shared")];

// expo-sqlite web support needs wasm treated as an asset
config.resolver.assetExts.push("wasm");

// ...and cross-origin isolation headers so SharedArrayBuffer works,
// which the wasm SQLite engine relies on.
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    return middleware(req, res, next);
  };
};

module.exports = config;
