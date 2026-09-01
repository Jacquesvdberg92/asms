/**
 * Errors that carry the status they deserve.
 *
 * Every thrown error used to become a 400, which made "no server with that id",
 * "stop the server first" and an unexpected internal failure indistinguishable
 * to the client - and left the internal one unlogged. Anything that is not one
 * of these is now a logged 500 with a generic message, so a stack trace or a
 * filesystem path can never leave in a response body.
 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** The thing you asked for is not here. */
export const notFound = (message: string): HttpError => new HttpError(message, 404);

/** The request is fine but the system is in the wrong state for it. */
export const conflict = (message: string): HttpError => new HttpError(message, 409);

/** The request itself is wrong. */
export const badRequest = (message: string): HttpError => new HttpError(message, 400);

/** Too many attempts, too fast. */
export const tooManyRequests = (message: string): HttpError => new HttpError(message, 429);
