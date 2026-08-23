const { withAndroidStyles } = require("expo/config-plugins");

// Android 15 (API 35) deprecated android:statusBarColor / android:navigationBarColor
// in favor of edge-to-edge (already enabled via gradle.properties' edgeToEdgeEnabled).
// Expo's default prebuild template still emits these two theme attributes, which is
// what Google Play's pre-launch report flags as "deprecated APIs or parameters for
// edge-to-edge". Since android/ is regenerated on every prebuild, strip them here so
// the fix survives rebuilds instead of hand-editing the generated styles.xml.
module.exports = function withEdgeToEdgeStyles(config) {
  return withAndroidStyles(config, (config) => {
    const styles = config.modResults.resources.style;
    const appTheme = Array.isArray(styles)
      ? styles.find((s) => s.$.name === "AppTheme")
      : undefined;
    if (appTheme && Array.isArray(appTheme.item)) {
      appTheme.item = appTheme.item.filter(
        (item) =>
          item.$.name !== "android:statusBarColor" &&
          item.$.name !== "android:navigationBarColor",
      );
    }
    return config;
  });
};
