import { expect, type Page, test } from "@playwright/test";

// README rules 8 and 9: the bell keeps the board's ratios and fits the window.

async function ringTheBell(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.clock.install();
  // The fake backend runs in the page. Nothing may leave the local server.
  await page.route("**/*", (route) =>
    route.request().url().startsWith("http://localhost:")
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/?backend=fake&fixture=today");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("timer", { name: "Time left" })).toBeVisible();
  // The longest default cycle is 90 minutes.
  await page.clock.fastForward(91 * 60_000);
  const bell = page.getByRole("dialog");
  await expect(bell).toBeVisible();
  return bell;
}

for (const [width, height] of [
  [420, 520],
  [1200, 420],
  [1000, 500],
]) {
  test(`${width}x${height}: the bell fits, and nothing overlaps`, async ({
    page,
  }) => {
    const bell = await ringTheBell(page, width, height);

    const box = await bell.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.width).toBeLessThanOrEqual(0.92 * width + 1);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height);

    const parts = await Promise.all(
      [".bell-heading", ".bell-field", ".bell-actions"].map((selector) =>
        bell.locator(selector).boundingBox(),
      ),
    );
    for (let index = 1; index < parts.length; index++) {
      const above = parts[index - 1];
      const below = parts[index];
      expect((above?.y ?? 0) + (above?.height ?? 0)).toBeLessThanOrEqual(
        below?.y ?? 0,
      );
    }
    for (const part of parts) {
      expect((part?.y ?? 0) + (part?.height ?? 0)).toBeLessThanOrEqual(
        box.y + box.height,
      );
    }
  });
}

test("1440x900: the bell has the board's 540px width", async ({ page }) => {
  const bell = await ringTheBell(page, 1440, 900);

  expect((await bell.boundingBox())?.width).toBeCloseTo(540, 0);
});
