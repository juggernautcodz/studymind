import { Response } from "express";

interface ApiErrorShape {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  toJSON(): ApiErrorShape {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  const body: ApiErrorShape = {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
  res.status(statusCode).json(body);
}

export function badRequest(
  res: Response,
  message: string,
  details?: unknown,
): void {
  sendError(res, 400, "BAD_REQUEST", message, details);
}

export function notFound(res: Response, message = "Resource not found"): void {
  sendError(res, 404, "NOT_FOUND", message);
}

export function unauthorized(
  res: Response,
  message = "Authentication required",
): void {
  sendError(res, 401, "UNAUTHORIZED", message);
}

export function forbidden(res: Response, message: string): void {
  sendError(res, 403, "FORBIDDEN", message);
}

export function serviceUnavailable(
  res: Response,
  code: string,
  message: string,
): void {
  sendError(res, 503, code, message);
}

export function internalError(
  res: Response,
  message = "An unexpected error occurred",
): void {
  sendError(res, 500, "INTERNAL_ERROR", message);
}
