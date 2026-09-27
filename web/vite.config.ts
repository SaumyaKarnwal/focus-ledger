import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Set here, not in a package script, so that every Vitest runner (CLI, watch, IDE) uses UTC.
process.env.TZ = "UTC";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Testing Library registers its automatic cleanup only when Vitest globals are on.
    globals: true,
  },
});
