import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import * as fs from "fs";
import * as path from "path";
import { createServer, type Server } from "node:http";
import { execSync } from "node:child_process";

const app = express();
const log = console.log;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function listenWithRetry(
  server: Server,
  port: number,
  host: string,
  maxRetries = 5,
  delayMs = 1000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    function tryListen() {
      attempt++;
      server.listen({ port, host }, () => {
        log(`express server serving on port ${port}`);
        resolve();
      });
      server.once("error", (err: NodeJS.ErrnoException) => {
        server.removeAllListeners("listening");
        if (err.code === "EADDRINUSE" && attempt < maxRetries) {
          log(`Port ${port} in use, retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`);
          setTimeout(tryListen, delayMs);
        } else {
          reject(err);
        }
      });
    }
    tryListen();
  });
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origins = new Set<string>();

    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }

    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d: string) => {
        origins.add(`https://${d.trim()}`);
      });
    }

    const origin = req.header("origin");

    const isLocalhost =
      origin?.startsWith("http://localhost:") ||
      origin?.startsWith("http://127.0.0.1:");

    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupSecurityHeaders(app: express.Application) {
  if (IS_PRODUCTION) {
    app.set("trust proxy", true);
  }

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.removeHeader("X-Powered-By");
    if (IS_PRODUCTION) {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=63072000; includeSubDomains; preload",
      );
    }
    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      limit: "50mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: "50mb" }));
}

function generateCorrelationId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const SENSITIVE_LOG_KEYS = new Set([
  "token",
  "password",
  "passwordHash",
  "newPassword",
  "code",
  "receiptData",
  "purchaseToken",
  "transactionId",
  "rawReceiptJson",
  "tokenHash",
]);

function redactSensitiveJson(replacerKey: string, value: unknown): unknown {
  if (SENSITIVE_LOG_KEYS.has(replacerKey)) return "[REDACTED]";
  return value;
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const correlationId =
      (req.headers["x-correlation-id"] as string) || generateCorrelationId();
    res.setHeader("x-correlation-id", correlationId);
    (req as any).correlationId = correlationId;

    const start = Date.now();
    const requestPath = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson as Record<string, unknown>;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!requestPath.startsWith("/api")) return;

      const duration = Date.now() - start;

      let logLine = `[${correlationId}] ${req.method} ${requestPath} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse, redactSensitiveJson)}`;
      }

      if (logLine.length > 120) {
        logLine = logLine.slice(0, 119) + "…";
      }

      log(logLine);
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

const FALLBACK_HTML =
  "<!DOCTYPE html><html><head><title>Study Mind</title></head><body><h1>Study Mind</h1></body></html>";

function loadTemplate(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    log(`WARNING: Template not found at ${filePath}: ${err}`);
    return FALLBACK_HTML;
  }
}

function configureExpoAndLanding(app: express.Application) {
  const landingPageTemplate = loadTemplate(
    path.resolve(process.cwd(), "server", "templates", "landing-page.html"),
  );

  const privacyPolicyTemplate = loadTemplate(
    path.resolve(process.cwd(), "server", "templates", "privacy-policy.html"),
  );

  const termsOfServiceTemplate = loadTemplate(
    path.resolve(process.cwd(), "server", "templates", "terms-of-service.html"),
  );

  const helpSupportTemplate = loadTemplate(
    path.resolve(process.cwd(), "server", "templates", "help-support.html"),
  );

  const appName = getAppName();

  const distDir = path.resolve(process.cwd(), "dist");
  const hasWebBuild = fs.existsSync(path.join(distDir, "index.html"));

  log(
    hasWebBuild
      ? "Serving static web build from dist/"
      : "No web build found in dist/",
  );
  log("Expo Go manifests served from static-build/ (if available)");

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      if (req.path === "/" || req.path === "/manifest") {
        const manifestPath = path.resolve(
          process.cwd(),
          "static-build",
          platform,
          "manifest.json",
        );
        if (fs.existsSync(manifestPath)) {
          return serveExpoManifest(platform, res);
        }
        return res.status(404).json({
          error:
            "Expo Go manifests not available in this deployment. Use a native build instead.",
        });
      }
    }

    if (req.path === "/privacy" || req.path === "/privacy-policy") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      return res.status(200).send(privacyPolicyTemplate);
    }

    if (req.path === "/terms" || req.path === "/terms-of-service") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      return res.status(200).send(termsOfServiceTemplate);
    }

    if (req.path === "/help" || req.path === "/support") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      return res.status(200).send(helpSupportTemplate);
    }

    if (req.path === "/robots.txt") {
      const forwardedProto = req.header("x-forwarded-proto") || req.protocol || "https";
      const host = req.header("x-forwarded-host") || req.get("host") || "localhost";
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.type("text/plain").send(`User-agent: *\nAllow: /\nSitemap: ${forwardedProto}://${host}/sitemap.xml\n`);
    }

    if (req.path === "/sitemap.xml") {
      const forwardedProto = req.header("x-forwarded-proto") || req.protocol || "https";
      const host = req.header("x-forwarded-host") || req.get("host") || "localhost";
      const baseUrl = `${forwardedProto}://${host}`;
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/dashboard</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseUrl}/privacy</loc>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>${baseUrl}/terms</loc>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>${baseUrl}/help</loc>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>
</urlset>`;
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.status(200).send(xml);
    }

    next();
  });

  const longCacheOpts = { maxAge: "1y", immutable: true };
  const noCacheOpts = { maxAge: 0, etag: true };

  app.use(
    "/assets",
    express.static(path.resolve(process.cwd(), "assets"), longCacheOpts),
  );
  app.use(
    express.static(path.resolve(process.cwd(), "static-build"), longCacheOpts),
  );

  if (hasWebBuild) {
    app.use(
      "/_expo/static",
      express.static(path.join(distDir, "_expo", "static"), longCacheOpts),
    );
    app.use(
      "/assets",
      express.static(path.join(distDir, "assets"), longCacheOpts),
    );
    app.use(express.static(distDir, noCacheOpts));

    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api")) return next();
      if (req.header("expo-platform")) return next();

      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(distDir, "index.html"), (err) => {
        if (err) {
          if (res.headersSent) return;
          serveLandingPage({ req, res, landingPageTemplate, appName });
        }
      });
    });
  } else {
    app.get("/", (req: Request, res: Response) => {
      serveLandingPage({ req, res, landingPageTemplate, appName });
    });
  }
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });
}

function setupGracefulShutdown(server: Server) {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received, shutting down gracefully...`);

    server.close(() => {
      log("Server closed.");
      process.exit(0);
    });

    setTimeout(() => {
      log("Forceful shutdown after timeout.");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.log("[Startup] DATABASE_URL missing");
  }

  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    console.error(
      "[Startup] WARNING: AI_INTEGRATIONS_OPENAI_API_KEY is not set. " +
      "All AI features (transcription, notes, flashcards, quizzes) will return 503.",
    );
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn(
      "[Startup] RESEND_API_KEY is not set. Password reset codes will be logged to console instead of emailed.",
    );
  }

  try {
    log("[Startup] Syncing database schema...");
    execSync("npx prisma generate && npx prisma db push --accept-data-loss", {
      stdio: "inherit",
      timeout: 60_000,
      env: { ...process.env },
    });
    log("[Startup] Database schema sync complete");
  } catch (err) {
    console.error("[Startup] prisma db push failed, continuing:", err);
  }

  const port = parseInt(process.env.PORT || "5000", 10);

  try {
    setupSecurityHeaders(app);
    setupCors(app);
    setupBodyParsing(app);
    setupRequestLogging(app);

    configureExpoAndLanding(app);

    app.get("/api/version", (_req, res) => {
      res.json({ version: "2026-02-07T1900-resilient-startup" });
    });

    app.get("/api/health", (_req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    try {
      const server = await registerRoutes(app);

      setupErrorHandler(app);

      await listenWithRetry(server, port, "0.0.0.0");

      setupGracefulShutdown(server);
    } catch (routeErr) {
      log(
        `WARNING: Route registration failed, starting minimal server: ${routeErr}`,
      );

      setupErrorHandler(app);

      const fallbackServer = createServer(app);
      await listenWithRetry(fallbackServer, port, "0.0.0.0");

      setupGracefulShutdown(fallbackServer);
    }
  } catch (fatalErr) {
    console.error("FATAL: Server startup failed:", fatalErr);
    const emergencyApp = express();
    emergencyApp.use((_req, res) => {
      res
        .status(503)
        .json({ error: "Server starting up", code: "STARTUP_FAILURE" });
    });
    const emergencyServer = createServer(emergencyApp);
    listenWithRetry(emergencyServer, port, "0.0.0.0").catch((e) => {
      console.error("Emergency server also failed to start:", e);
      process.exit(1);
    });
  }
})();