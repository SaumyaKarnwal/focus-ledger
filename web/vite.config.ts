import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Testing Library registers its automatic cleanup only when Vitest globals are on.
    globals: true,
  },
});
