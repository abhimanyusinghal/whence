import type { NextFunction, Request, Response } from "express";

/**
 * Auth identity attached to /analyze requests. `is_anonymous: true` means the
 * caller did not present a bearer token AND auth is not required (REQUIRE_AUTH=false).
 * The Chrome extension calls this way during local dev.
 */
export type Principal = {
  name: string;
  is_anonymous: boolean;
};

declare module "express-serve-static-core" {
  interface Request {
    principal?: Principal;
  }
}

let _keys: Map<string, string> | null = null;

/**
 * Parse `API_KEYS=tok_alpha:partner_a,tok_beta:partner_b` env into a token→name map.
 * Names are the public identifier surfaced in logs and rate-limit buckets.
 * Tokens themselves never leave this module.
 */
function loadKeys(): Map<string, string> {
  if (_keys) return _keys;
  _keys = new Map();
  const raw = process.env.API_KEYS ?? "";
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const token = trimmed.slice(0, idx).trim();
    const name = trimmed.slice(idx + 1).trim();
    if (token && name) _keys.set(token, name);
  }
  return _keys;
}

/** Test helper — reset cached parse so a new env value takes effect. */
export function _resetKeyCache(): void {
  _keys = null;
}

export type AuthOptions = {
  required: boolean;
};

export function authMiddleware(opts: AuthOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header("authorization") ?? "";
    const match = /^Bearer\s+(\S+)$/i.exec(header);

    if (!match) {
      if (opts.required) {
        res.status(401).json({
          error: "missing_auth",
          message: "Authorization: Bearer <token> required",
        });
        return;
      }
      req.principal = { name: "anonymous", is_anonymous: true };
      next();
      return;
    }

    const token = match[1];
    const name = loadKeys().get(token);

    if (!name) {
      res.status(401).json({
        error: "invalid_token",
        message: "Invalid bearer token",
      });
      return;
    }

    req.principal = { name, is_anonymous: false };
    next();
  };
}
