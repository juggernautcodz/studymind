export const ANONYMOUS_USER_ID = "anonymous-guest-user";

export const MAX_REQUEST_BODY_SIZE = "50mb";

export const AI_RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 10,
} as const;

export const TRANSCRIPTION_RATE_LIMIT = {
  windowMs: 60_000,
  maxRequests: 5,
} as const;
