#!/usr/bin/env node
/**
 * Production Audit Gate
 * - Runs build
 * - Verifies build artifacts
 * - Boots production server
 * - Probes health + web
 * - Writes REPORT_FOR_CHATGPT.md
 * - Shuts down server
 *
 * Usage:
 *   node scripts/audit.cjs
 *
 * Optional env:
 *   AUDIT_PORT=3002
 *   AUDIT_TIMEOUT_MS=45000
 *   AUDIT_SKIP_BUILD=1
 */

const { spawn, execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ROOT = process.cwd();

const PORT = Number(process.env.AUDIT_PORT || process.env.PORT || 3002);
const TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 45_000);
const SKIP_BUILD = process.env.AUDIT_SKIP_BUILD === "1";

const ARTIFACTS = [
  { file: "dist/index.html", why: "Expo web export output" },
  { file: "server_dist/index.mjs", why: "Bundled production server" },
];

const PROBES = [
  { path: "/api/health", expectStatus: 200, expectContains: `"status"` },
  { path: "/", expectStatus: 200, expectContains: "<" },
  { path: "/dashboard", expectStatus: 200, expectContains: "<" },
  { path: "/privacy", expectStatus: 200, expectContains: "<" },
  { path: "/robots.txt", expectStatus: 200, expectContains: "User-agent" },
];

const ENV_VARS_REFERENCED = [
  "PORT",
  "NODE_ENV",
  "DATABASE_URL",
  "SESSION_SECRET",
  "REPLIT_DEV_DOMAIN",
  "REPLIT_DOMAINS",
  "REPLIT_DEPLOYMENT_URL",
  "REPL_SLUG",
  "REPL_OWNER",
  "EXPO_PUBLIC_DOMAIN",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",
  "GOOGLE_PLAY_PACKAGE_NAME",
  "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
];

const report = {
  timestamp: new Date().toISOString(),
  nodeVersion: process.version,
  verdict: "UNKNOWN",
  artifacts: [],
  probes: [],
  mountedRoutes: [],
  envVars: ENV_VARS_REFERENCED,
  errors: [],
};

function log(msg) {
  process.stdout.write(`${msg}\n`);
}
function warn(msg) {
  process.stderr.write(`WARN: ${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`FAIL: ${msg}\n`);
  report.errors.push(msg);
  process.exitCode = 1;
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function fileSize(rel) {
  try {
    const stat = fs.statSync(path.join(ROOT, rel));
    const kb = (stat.size / 1024).toFixed(1);
    return `${kb} KB`;
  } catch {
    return "N/A";
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    log(`\n$ ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...opts,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code}): ${cmd} ${args.join(" ")}`));
    });
  });
}

function httpGet({ path: reqPath }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: reqPath,
        method: "GET",
        timeout: TIMEOUT_MS,
        headers: {
          "User-Agent": "prod-audit/1.0",
          Accept: "*/*",
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error(`Request timed out after ${TIMEOUT_MS}ms: ${reqPath}`));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForServer(serverOutput) {
  const start = Date.now();
  let lastErr = null;

  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const res = await httpGet({ path: "/api/health" });
      if (res.status === 200) return;
      lastErr = new Error(`Health returned status ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  throw lastErr || new Error("Server did not become ready in time");
}

function extractRoutes(output) {
  const routes = [];
  const re = /Mounted (\w+) at (\/\S+)/g;
  let m;
  while ((m = re.exec(output)) !== null) {
    routes.push(`${m[1]} -> ${m[2]}`);
  }
  return routes;
}

function writeReport() {
  const lines = [];
  lines.push("# Production Audit Report");
  lines.push("");
  lines.push(`**Timestamp:** ${report.timestamp}`);
  lines.push(`**Node Version:** ${report.nodeVersion}`);
  lines.push(`**Verdict:** ${report.verdict}`);
  lines.push("");

  lines.push("## Build Artifacts");
  lines.push("");
  lines.push("| File | Size | Status |");
  lines.push("|------|------|--------|");
  for (const a of report.artifacts) {
    lines.push(`| \`${a.file}\` | ${a.size} | ${a.status} |`);
  }
  lines.push("");

  lines.push("## Probe Results");
  lines.push("");
  lines.push("| Endpoint | Expected | Got | Status |");
  lines.push("|----------|----------|-----|--------|");
  for (const p of report.probes) {
    lines.push(`| \`${p.path}\` | ${p.expected} | ${p.got} | ${p.status} |`);
  }
  lines.push("");

  if (report.mountedRoutes.length > 0) {
    lines.push("## Mounted Routes");
    lines.push("");
    for (const r of report.mountedRoutes) {
      lines.push(`- ${r}`);
    }
    lines.push("");
  }

  lines.push("## Environment Variables Referenced in Code");
  lines.push("");
  lines.push("Names only (no values):");
  lines.push("");
  for (const v of report.envVars) {
    lines.push(`- \`${v}\``);
  }
  lines.push("");

  if (report.errors.length > 0) {
    lines.push("## Errors");
    lines.push("");
    for (const e of report.errors) {
      lines.push(`- ${e}`);
    }
    lines.push("");
  }

  const content = lines.join("\n");
  fs.writeFileSync(path.join(ROOT, "REPORT_FOR_CHATGPT.md"), content);
  log(`\nReport written to REPORT_FOR_CHATGPT.md`);
}

async function main() {
  log("=== Production Audit Gate ===");
  log(`PORT=${PORT} TIMEOUT_MS=${TIMEOUT_MS} SKIP_BUILD=${SKIP_BUILD ? "1" : "0"}`);

  if (!SKIP_BUILD) {
    try {
      await run("node", ["scripts/build.cjs"], {
        env: { ...process.env, NODE_ENV: "production" },
      });
    } catch (e) {
      fail(`Build step failed: ${e.message}`);
      report.verdict = "FAIL";
      writeReport();
      return;
    }
  } else {
    warn("Skipping build (AUDIT_SKIP_BUILD=1). Hope you know what you're doing.");
  }

  log("\nChecking build artifacts...");
  for (const a of ARTIFACTS) {
    const found = exists(a.file);
    const size = found ? fileSize(a.file) : "N/A";
    const status = found ? "OK" : "MISSING";
    report.artifacts.push({ file: a.file, why: a.why, size, status });
    if (!found) {
      fail(`Missing artifact: ${a.file} (${a.why})`);
    } else {
      log(`OK: ${a.file} (${size})`);
    }
  }
  if (process.exitCode) {
    report.verdict = "FAIL";
    writeReport();
    return;
  }

  log("\nStarting production server...");
  let serverOutput = "";
  const child = spawn("node", ["server_dist/index.mjs"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production", PORT: String(PORT) },
  });

  child.stdout.on("data", (d) => {
    const s = d.toString();
    serverOutput += s;
    process.stdout.write(s);
  });
  child.stderr.on("data", (d) => {
    const s = d.toString();
    serverOutput += s;
    process.stderr.write(s);
  });

  let exited = false;
  let stopping = false;
  child.on("exit", (code, signal) => {
    exited = true;
    if (stopping) return;
    if (signal) {
      fail(`Server killed by signal ${signal}`);
    } else if (code !== 0) {
      fail(`Server exited early with code ${code}`);
    }
  });

  try {
    await waitForServer();
    log("Server is ready.");
  } catch (e) {
    fail(`Server did not become ready: ${e.message}`);
    try { child.kill("SIGTERM"); } catch {}
    report.verdict = "FAIL";
    report.mountedRoutes = extractRoutes(serverOutput);
    writeReport();
    return;
  }

  report.mountedRoutes = extractRoutes(serverOutput);

  log("\nProbing endpoints...");
  for (const p of PROBES) {
    try {
      const res = await httpGet({ path: p.path });
      const ok = res.status === p.expectStatus &&
        (!p.expectContains || res.body.includes(p.expectContains));
      report.probes.push({
        path: p.path,
        expected: p.expectStatus,
        got: res.status,
        status: ok ? "PASS" : "FAIL",
      });
      if (!ok) {
        if (res.status !== p.expectStatus) {
          fail(`${p.path}: expected ${p.expectStatus}, got ${res.status}`);
        } else {
          fail(`${p.path}: response missing expected content`);
        }
      } else {
        log(`OK: ${p.path}`);
      }
    } catch (e) {
      report.probes.push({
        path: p.path,
        expected: p.expectStatus,
        got: "ERR",
        status: "FAIL",
      });
      fail(`${p.path}: request failed: ${e.message}`);
    }
  }

  log("\nShutting down server...");
  stopping = true;
  if (!exited) {
    try {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 750));
      if (!exited) child.kill("SIGINT");
      await new Promise((r) => setTimeout(r, 750));
      if (!exited) child.kill("SIGKILL");
    } catch {}
  }

  report.verdict = process.exitCode ? "FAIL" : "PASS";
  writeReport();

  if (process.exitCode) {
    fail("Audit FAILED. Fix issues above before deploying.");
  } else {
    log("Audit PASSED. Ship it responsibly.");
  }
}

main().catch((e) => {
  fail(`Unexpected audit error: ${e.stack || e.message}`);
  report.verdict = "FAIL";
  writeReport();
});
