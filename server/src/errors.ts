import type { Request, Response, NextFunction } from "express";

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: Record<string, string>;
  };
};

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: Record<string, string>
): void {
  const body: ApiErrorBody = { error: { code, message } };
  if (details && Object.keys(details).length > 0) {
    body.error.details = details;
  }
  res.status(status).json(body);
}

export function notFoundHandler(_req: Request, res: Response): void {
  sendError(res, 404, "NOT_FOUND", "Route not found");
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) return;
  const message = err instanceof Error ? err.message : "Internal server error";
  sendError(res, 500, "INTERNAL_ERROR", message);
}
