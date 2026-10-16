// Node module hook: load test stand-ins for the Expo/React Native pieces and
// map the app's "@/..." alias, so the real sync code runs in plain Node.
const here = (file) => new URL(file, import.meta.url).href;
const MAP = {
  "expo-sqlite": here("./expo-sqlite-shim.mjs"),
  "expo-file-system/legacy": here("./file-system-shim.mjs"),
  "@/constants/api": here("./api-shim.mjs"),
  "@/lib/auth": here("./auth-shim.mjs"),
  "@/lib/sync/db": here("../db.js"),
  "@/lib/sync/task-photo": here("../task-photo.js"),
};

export async function resolve(specifier, context, nextResolve) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true };
  return nextResolve(specifier, context);
}
