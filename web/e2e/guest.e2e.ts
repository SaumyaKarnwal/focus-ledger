import { expect, test } from "@playwright/test";

// README "Guest mode": with no session, the app opens on Start as a guest.
// The guest's ledger lives in this browser's IndexedDB: a cycle and the
// Report work, and both are still there after a reload.
test("a guest runs a cycle, sees it on Report, and keeps it after a reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The fake backend runs in the page. Nothing may leave the local server.
  await page.route("**/*", (route) =>
    route.request().url().startsWith("http://localhost:")
      ? route.continue()
      : route.abort(),
  );
  await page.clock.install({ time: new Date("2026-11-02T09:00:00Z") });
  await page.goto("/?backend=fake&fixture=signed-out");

  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.clock.fastForward("05:00");
  await page.getByRole("button", { name: "Stop and log 5 min" }).click();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();

  const reportTotal = async () => {
    await page.goto("/report?backend=fake&fixture=signed-out");
    await page
      .getByRole("group", { name: "Range" })
      .getByRole("button", { name: "Today" })
      .click();
    return page.getByLabel("Total");
  };
  await expect(await reportTotal()).toHaveText("5m");

  // A reload reads the same ledger back from IndexedDB.
  await page.reload();
  await expect(await reportTotal()).toHaveText("5m");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
