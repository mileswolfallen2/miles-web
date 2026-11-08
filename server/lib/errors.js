export class AppError extends Error {
  constructor(status, code, message, details, expose = status < 500) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = expose;
  }
}

export const badRequest = (message = 'Invalid request', details) =>
  new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Unauthorized') =>
  new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'Forbidden') =>
  new AppError(403, 'forbidden', message);
export const notFound = (message = 'Not found') =>
  new AppError(404, 'not_found', message);
export const tooManyRequests = (message = 'Too many requests', retryAfterMs) =>
  new AppError(429, 'rate_limited', message, { retryAfterMs });
export const unavailable = (message = 'Service unavailable') =>
  new AppError(503, 'unavailable', message);
