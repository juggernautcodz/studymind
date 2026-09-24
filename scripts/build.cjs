const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function stubDebuggerShell() {
  const shellStub = `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unstable_prepareDebuggerShell = async function() { return { code: "success" }; };
exports.unstable_spawnDebuggerShellWithArgs = async function() {};
`;

  const launcherStub = `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
  launchDebuggerAppWindow: async function() {},
  unstable_showFuseboxShell: async function() {},
  unstable_prepareFuseboxShell: async function() { return { code: "success" }; },
};
`;

  const launchUtilsStub = `
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareDebuggerShellFromDotSlashFile = async function() { return { code: "success" }; };
exports.spawnAndGetStderr = async function() { return { code: 0, stderr: "" }; };
`;

  const stubs = [
    [path.join("node_modules", "@react-native", "debugger-shell", "dist", "index.js"), shellStub],
    [path.join("node_modules", "@react-native", "debugger-shell", "dist", "node", "index.js"), shellStub],
    [path.join("node_modules", "@react-native", "debugger-shell", "dist", "node", "private", "LaunchUtils.js"), launchUtilsStub],
    [path.join("node_modules", "@react-native", "dev-middleware", "dist", "utils", "DefaultBrowserLauncher.js"), launcherStub],
  ];

  for (const [target, code] of stubs) {
    if (fs.existsSync(target)) {
      fs.writeFileSync(target, code);
      console.log(`Stubbed: ${path.basename(target)}`);
    }
  }
}

function main() {
  console.log("=== Production Build ===");
  console.log("");

  stubDebuggerShell();
  console.log("");

  console.log("Step 1: Prisma generate");
  try {
    execSync("npx prisma generate", { stdio: "inherit", timeout: 60_000 });
    console.log("Prisma generate complete");
  } catch (error) {
    console.error("Prisma generate failed:", error.message);
    process.exit(1);
  }
  console.log("");

  console.log("Step 2: Expo web export");
  const domain = process.env.REPLIT_DEPLOYMENT_URL
    || process.env.REPLIT_DEV_DOMAIN
    || (process.env.REPL_SLUG && process.env.REPL_OWNER
      ? `${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
      : undefined);

  const isDeployment = !!process.env.REPLIT_DEPLOYMENT_URL;
  const publicDomain = domain
    ? (isDeployment ? domain : `${domain}:5000`)
    : undefined;

  console.log(`EXPO_PUBLIC_DOMAIN=${publicDomain || "(not set)"}`);

  const env = {
    ...process.env,
    EXPO_PUBLIC_DOMAIN: publicDomain,
    NODE_ENV: "production",
  };

  try {
    execSync("npx expo export --platform web --output-dir dist", {
      stdio: "inherit",
      env,
      timeout: 300_000,
    });
  } catch (error) {
    console.error("Expo web export failed:", error.message);
    process.exit(1);
  }

  if (!fs.existsSync("dist/index.html")) {
    console.error("ERROR: dist/index.html not found after export");
    process.exit(1);
  }

  const files = fs.readdirSync("dist");
  console.log(`Expo web export complete: ${files.length} files in dist/`);
  console.log("");

  console.log("Step 3: Server build");
  try {
    execSync("npm run server:build", { stdio: "inherit", timeout: 60_000 });
  } catch (error) {
    console.error("Server build failed:", error.message);
    process.exit(1);
  }

  console.log("");
  console.log("=== Build complete ===");
}

main();
