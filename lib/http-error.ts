/**
 * The error every API route knows how to turn into a response.
 *
 * It lives in its own file so that modules the route layer depends on can
 * throw it without importing lib/teacher-server, which imports them back.
 * lib/teacher-server re-exports it, so every existing import still works.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    // Optional internal detail (e.g. an upstream provider's status and error
    // body) recorded for diagnosis but never shown to the user.
    public detail?: string,
  ) {
    super(message);
  }
}
