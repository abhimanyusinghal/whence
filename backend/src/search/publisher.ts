/**
 * Best-effort publisher (display hostname) extraction from a URL.
 * Returns "unknown" when the URL is unparseable so downstream code can
 * always assume a string is present.
 */
export function publisherFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}
