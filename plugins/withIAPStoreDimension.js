const { withAppBuildGradle } = require("expo/config-plugins");

// react-native-iap v12 ships build variants for both Amazon Appstore and
// Google Play, so Gradle needs to be told which one to resolve — normally
// via the library's own Expo config plugin (node_modules/react-native-iap/
// app.plugin.js). That plugin also tries to insert a legacy
// `supportLibVersion = "28.0.0"` line into the project-level build.gradle
// (a pre-AndroidX concern, unneeded here) using a fragile line-matching
// heuristic that breaks against this project's build.gradle structure
// ("Could not set unknown property 'supportLibVersion' for root project").
// This does only the part that's actually needed: missingDimensionStrategy
// "store", "play" in app/build.gradle's defaultConfig.
module.exports = function withIAPStoreDimension(config) {
  return withAppBuildGradle(config, (config) => {
    const line = 'missingDimensionStrategy "store", "play"';
    if (config.modResults.contents.includes(line)) return config;
    config.modResults.contents = config.modResults.contents.replace(
      /defaultConfig\s*{/,
      (match) => `${match}\n        ${line}`,
    );
    return config;
  });
};
