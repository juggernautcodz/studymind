const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Force all react-refresh imports to resolve via the top-level package.
// react-native ships its own nested react-refresh@0.14.2 in node_modules/react-native/node_modules/
// whose cjs/ files Metro cannot SHA-1 (its file crawler skips deeply-nested node_modules on Windows).
// The top-level react-refresh@0.18.0 has the same public API and IS watched by Metro.
const REACT_REFRESH_ROOT = path.resolve(__dirname, "node_modules/react-refresh");
const REACT_REFRESH_EXPORTS = {
  ".":          "runtime.js",
  "./runtime":  "runtime.js",
  "./babel":    "babel.js",
  "./package.json": "package.json",
};

const originalResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react-refresh" || moduleName.startsWith("react-refresh/")) {
    // Normalize to exports-map key format: "." or "./runtime" etc.
    const key =
      moduleName === "react-refresh"
        ? "."
        : "." + moduleName.slice("react-refresh".length);
    const mapped = REACT_REFRESH_EXPORTS[key];
    if (mapped) {
      return { type: "sourceFile", filePath: path.join(REACT_REFRESH_ROOT, mapped) };
    }
    // Fallback: use the suffix after the package name as a relative path
    const sub = moduleName.slice("react-refresh/".length);
    return { type: "sourceFile", filePath: path.join(REACT_REFRESH_ROOT, sub) };
  }
  if (originalResolver) {
    return originalResolver(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
