import { loadEnv, type Plugin } from "vite";

const EMPTY_TAG = '<meta name="google-client-id" content="" />';

/** In production the server fills the tag. The dev server fills it from the repository .env. */
export function setGoogleClientId(html: string, clientId: string): string {
  const escaped = clientId
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return html.replace(
    EMPTY_TAG,
    `<meta name="google-client-id" content="${escaped}" />`,
  );
}

export function googleClientIdHtml(): Plugin {
  let clientId = "";
  return {
    name: "google-client-id-html",
    apply: "serve",
    configResolved(config) {
      clientId =
        loadEnv(config.mode, config.envDir || process.cwd(), "GOOGLE_CLIENT_ID")
          .GOOGLE_CLIENT_ID ?? "";
    },
    transformIndexHtml: (html) => setGoogleClientId(html, clientId),
  };
}
