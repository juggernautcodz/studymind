const { spawn } = require("child_process");
const http = require("http");

const PORT = 5000;
const MAX_WAIT_MS = 15000;
const MAX_WAIT_SECONDS = MAX_WAIT_MS / 1000;
const POLL_INTERVAL_MS = 500;

function checkHealth() {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}/api/health`, (res) => {
      if (res.statusCode === 200) {
        resolve(true);
      } else {
        reject(new Error(`Health check returned ${res.statusCode}`));
      }
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.setTimeout(2000, () => {
      req.destroy();
      reject(new Error("Health check timeout"));
    });
  });
}

async function waitForHealth(maxWaitMs) {
  const startTime = Date.now();
  let lastError = null;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      await checkHealth();
      return true;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  throw new Error(
    `Health check failed after ${maxWaitMs}ms. Last error: ${lastError?.message || "unknown"}`,
  );
}

async function killServerGracefully(serverProcess, timeout = 5000) {
  const exitPromise = new Promise((resolve) => {
    serverProcess.once("exit", resolve);
  });
  
  serverProcess.kill("SIGTERM");
  
  // Wait for graceful exit with timeout
  const exited = await Promise.race([
    exitPromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), timeout)),
  ]);
  
  // Force kill if not exited
  if (!exited) {
    console.log("\nServer did not exit gracefully, force killing...");
    serverProcess.kill("SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function main() {
  console.log("=== Production Boot Test ===");
  console.log("");

  const env = {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: "production",
  };

  console.log(`Starting production server on PORT=${PORT}...`);

  const serverProcess = spawn("node", ["server_dist/index.mjs"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverOutput = "";
  let serverError = "";

  serverProcess.stdout.on("data", (data) => {
    const output = data.toString();
    serverOutput += output;
    process.stdout.write(output);
  });

  serverProcess.stderr.on("data", (data) => {
    const output = data.toString();
    serverError += output;
    process.stderr.write(output);
  });

  serverProcess.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`\nServer process exited with code ${code}`);
      process.exit(1);
    }
    if (signal) {
      console.log(`\nServer process killed with signal ${signal}`);
    }
  });

  try {
    console.log(`Waiting up to ${MAX_WAIT_SECONDS}s for /api/health to return 200...`);
    await waitForHealth(MAX_WAIT_MS);
    console.log("\n✓ Health check passed!");
    console.log("✓ Production boot test successful");
    
    await killServerGracefully(serverProcess);
    process.exit(0);
  } catch (err) {
    console.error("\n✗ Health check failed:", err.message);
    console.error("\n=== Server Output ===");
    console.error(serverOutput);
    if (serverError) {
      console.error("\n=== Server Errors ===");
      console.error(serverError);
    }
    
    await killServerGracefully(serverProcess);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
