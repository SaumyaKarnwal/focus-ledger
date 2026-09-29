import react from "@vitejs/plugin-react";
import { loadEnv, searchForWorkspaceRoot } from "vite";
import { defineConfig } from "vitest/config";
import { googleClientIdHtml } from "./googleClientIdHtml.ts";
import { productNameHtml } from "./productNameHtml.ts";

// Set here, not in a package script, so that every Vitest runner (CLI, watch, IDE) uses UTC.
process.env.TZ = "UTC";

export default defineConfig(({ mode }) => {
  const backendPort = loadEnv(mode, "..", "PORT").PORT || "8080";
  return {
    plugins: [react(), productNameHtml(), googleClientIdHtml()],
    // The web app shares the repository .env. Only this prefix reaches the bundle.
    envDir: "..",
    envPrefix: ["VITE_"],
    server: {
      // The fake backend imports the shared example data from ../testdata.
      fs: { allow: [searchForWorkspaceRoot(process.cwd()), "../testdata"] },
      // `./gradlew :backend:app:runLocal` serves the gRPC-Web calls on PORT.
      proxy: {
        "/focusledger.v1.LedgerService": `http://localhost:${backendPort}`,
      },
    },
    test: {
      environment: "jsdom",
      // Testing Library registers its automatic cleanup only when Vitest globals are on.
      globals: true,
    },
  };
});
