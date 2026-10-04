import { beforeEach } from "vitest";

// The app reads its page from the address, so every test starts at home.
// Tests in the node environment have no window.
beforeEach(() => {
  if (typeof window !== "undefined") window.history.replaceState(null, "", "/");
});
