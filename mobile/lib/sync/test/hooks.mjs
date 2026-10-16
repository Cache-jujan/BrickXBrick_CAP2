// Node module hook: make `import "expo-sqlite"` load the test stand-in.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "expo-sqlite") {
    return { url: new URL("./expo-sqlite-shim.mjs", import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
