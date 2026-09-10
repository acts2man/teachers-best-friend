import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Reads a fetch Response as JSON, tolerating non-JSON bodies. Our API routes
 * always return JSON, but a hosting gateway can intercept a request before it
 * reaches us — most often when a serverless function exceeds its platform time
 * limit — and return an HTML error page instead. Parsing that HTML with
 * `response.json()` throws an opaque "Unexpected token '<'" error that surfaces
 * to teachers verbatim. Translate those bodies into a clear, actionable
 * message while passing real JSON (success or our own error payloads) through
 * unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(response: Response): Promise<any> {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new Error(
      response.status === 502 ||
        response.status === 503 ||
        response.status === 504 ||
        response.status === 408 ||
        response.status === 0
        ? "The server took too long to respond. Your uploads are saved — please try again, and split large documents into fewer pages."
        : "We couldn’t reach the server just now. Please check your connection and try again.",
    );
  }
}
