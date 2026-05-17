import { Response, NextFunction } from "express";
import { AuthRequest } from "../auth";

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  message?: string;
}

interface RequestRecord {
  count: number;
  resetAt: number;
}

const stores = new Map<string, Map<string, RequestRecord>>();

function getStore(name: string): Map<string, RequestRecord> {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

export function rateLimit(name: string, config: RateLimitConfig) {
  const { windowMs, maxRequests, message } = config;
  const store = getStore(name);

  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of store) {
      if (record.resetAt <= now) {
        store.delete(key);
      }
    }
  }, windowMs);

  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const key = req.user?.id || req.ip || "unknown";
    const now = Date.now();
    let record = store.get(key);

    if (!record || record.resetAt <= now) {
      record = { count: 0, resetAt: now + windowMs };
      store.set(key, record);
    }

    record.count++;

    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, maxRequests - record.count)),
    );
    res.setHeader(
      "X-RateLimit-Reset",
      String(Math.ceil(record.resetAt / 1000)),
    );

    if (record.count > maxRequests) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: message || "Too many requests. Please try again later.",
          retryAfterSeconds: retryAfter,
        },
      });
    }

    next();
  };
}
