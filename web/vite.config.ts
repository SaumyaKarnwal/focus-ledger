import react from "@vitejs/plugin-react";
import { searchForWorkspaceRoot } from "vite";
import { defineConfig } from "vitest/config";
import { productNameHtml } from "./productNameHtml.ts";

// Set here, not in a package script, so that every Vitest runner (CLI, watch, IDE) uses UTC.
process.env.TZ = "UTC";

export default defineConfig({
  plugins: [react(), productNameHtml()],
  server: {
    // The fake backend imports the shared example data from ../testdata.
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), "../testdata"] },
  },
  test: {
    environment: "jsdom",
    // Testing Library registers its automatic cleanup only when Vitest globals are on.
    globals: true,
  },
});
