import { expect, type Locator, type Page, test } from "@playwright/test";

// README rule 11: every button on a mode screen has a ledge and moves onto it.

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  // The fake backend runs in the page. Nothing may leave the local server.
  await page.route("**/*", (route) =>
    route.request().url().startsWith("http://localhost:")
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/?backend=fake&fixture=today");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  // A late font swap would move the buttons between two measurements.
  await page.evaluate(() => document.fonts.ready);
}

function shadow(button: Locator) {
  return button.evaluate((element) => getComputedStyle(element).boxShadow);
}

async function expectLedgeAndPress(page: Page, button: Locator) {
  await page.evaluate(() => document.fonts.ready);
  // A 6px lower edge in a color, not "none".
  expect(await shadow(button)).toMatch(/^(rgb|color)\(.+\) 0px 6px 0px 0px$/);
  const rest = await button.boundingBox();
  await button.hover();
  await page.mouse.down();
  await expect
    .poll(async () => (await button.boundingBox())?.y)
    .toBeCloseTo((rest?.y ?? 0) + 6, 0);
  // A release away from the button presses it without a click.
  await page.mouse.move(1, 1);
  await page.mouse.up();
}

test("Take a break and Stop and log have the ledge and the press", async ({
  page,
}) => {
  await open(page);
  const takeABreak = page.getByRole("button", { name: "Take a break" });

  await expectLedgeAndPress(page, takeABreak);
  // The secondary ledge is not the primary's color.
  expect(await shadow(takeABreak)).not.toBe(
    await shadow(page.getByRole("button", { name: "Start" })),
  );

  await page.getByRole("button", { name: "Start" }).click();
  await expectLedgeAndPress(
    page,
    page.getByRole("button", { name: /Stop and log/ }),
  );
});

test("Start a cycle on Break has the ledge", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Take a break" }).click();

  await expectLedgeAndPress(
    page,
    page.getByRole("button", { name: "Start a cycle" }),
  );
});
