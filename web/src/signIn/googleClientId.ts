/** The Google client ID from the page's meta tag, which the server fills. */
export function readGoogleClientId(
  doc: Document = document,
): string | undefined {
  const content = doc
    .querySelector('meta[name="google-client-id"]')
    ?.getAttribute("content")
    ?.trim();
  return content || undefined;
}
