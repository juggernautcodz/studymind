const fs = require("fs");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

const requiredFiles = [
  "app.json",
  "package.json",
  ".replit",
  "client/App.tsx",
  "client/navigation/RootStackNavigator.tsx",
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) fail(`Missing required file: ${file}`);
  ok(`Found ${file}`);
}

const appJson = JSON.parse(fs.readFileSync("app.json", "utf8"));
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const replit = fs.readFileSync(".replit", "utf8");
const appTsx = fs.readFileSync("client/App.tsx", "utf8");

if (!packageJson.dependencies?.expo) fail("expo dependency missing from package.json");
ok(`expo version present: ${packageJson.dependencies.expo}`);

if (appJson.expo?.newArchEnabled !== undefined) fail("app.json still contains newArchEnabled");
ok("app.json does not contain newArchEnabled");

if (appJson.expo?.android?.edgeToEdgeEnabled !== undefined) {
  fail("app.json still contains android.edgeToEdgeEnabled");
}
ok("app.json does not contain android.edgeToEdgeEnabled");

if (!replit.includes('localPort = 5000') || !replit.includes('externalPort = 80')) {
  fail(".replit does not expose backend 5000 as external 80");
}
ok(".replit maps 5000 -> 80");

if (!replit.includes('localPort = 8081') || !replit.includes('externalPort = 3001')) {
  fail(".replit does not expose Expo 8081 as external 3001");
}
ok(".replit maps 8081 -> 3001");

if (appTsx.includes("StudyMind bare render test")) {
  fail("client/App.tsx still contains temporary bare render test");
}
ok("client/App.tsx is not the temporary bare render test");

console.log("Preflight checks passed.");