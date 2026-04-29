import type { NextFunction, Request, Response } from "express";

/**
 * Per-principal token-bucket rate limiter. In-memory; resets on process restart.
 * Tunable via env: RATE_LIMIT_PER_MINUTE (default 60), RATE_LIMIT_BURST (default 30).
 *
 * For Phase 1 this is sufficient — single-process backend, low traffic.
 * When we move behind multiple workers / a hosted edge, replace with Redis or
 * the platform's native rate limiter (Cloudflare's built-in).
 */
type Bucket = { tokens: number; lastRefillMs: number };

const buckets = new Map<string, Bucket>();

function ratePerMinute(): number {
  return Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60);
}

function burst(): number {
  return Number(process.env.RATE_LIMIT_BURST ?? 30);
}

export function checkRateLimit(principal: string): {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
} {
  const rpm = ratePerMinute();
  const cap = burst();
  const now = Date.now();

  let b = buckets.get(principal);
  if (!b) {
    b = { tokens: cap, lastRefillMs: now };
    buckets.set(principal, b);
  }

  // Refill: rpm per 60s, prorated by elapsed time, capped at burst.
  const elapsedMs = now - b.lastRefillMs;
  b.tokens = Math.min(cap, b.tokens + (elapsedMs * rpm) / 60_000);
  b.lastRefillMs = now;

  if (b.tokens < 1) {
    const needed = 1 - b.tokens;
    const retryMs = Math.ceil((needed * 60_000) / rpm);
    return { allowed: false, retryAfterMs: retryMs, remaining: 0 };
  }

  b.tokens -= 1;
  return {
    allowed: true,
    retryAfterMs: 0,
    remaining: Math.floor(b.tokens),
  };
}

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const principal = req.principal?.name ?? "anonymous";
  const result = checkRateLimit(principal);

  res.setHeader("X-RateLimit-Limit", String(burst()));
  res.setHeader("X-RateLimit-Remaining", String(result.remaining));

  if (!result.allowed) {
    res.setHeader("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
    res.status(429).json({
      error: "rate_limited",
      message: `Rate limit exceeded for principal "${principal}". Retry in ${Math.ceil(result.retryAfterMs / 1000)}s.`,
      retry_after_ms: result.retryAfterMs,
    });
    return;
  }

  next();
}

/** Test helper — clear all buckets between runs. */
export function _resetBuckets(): void {
  buckets.clear();
}
