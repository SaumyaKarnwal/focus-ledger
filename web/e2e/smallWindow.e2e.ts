/// <reference lib="dom" />
import { expect, type Page, test } from "@playwright/test";

// README rule 9: the timer screens shrink in steps by fit, and never scroll.

type Box = { x: number; y: number; width: number; height: number };

async function openStart(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  // The fake backend runs in the page. Nothing may leave the local server.
  await page.route("**/*", (route) =>
    route.request().url().startsWith("http://localhost:")
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/?backend=fake&fixture=today");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
}

async function box(page: Page, selector: string): Promise<Box> {
  const found = await page.locator(selector).first().boundingBox();
  if (!found) throw new Error(`no box for ${selector}`);
  return found;
}

function radioTops(page: Page): Promise<number[]> {
  return page
    .getByRole("radio")
    .evaluateAll((radios) =>
      radios.map((radio) => Math.round(radio.getBoundingClientRect().y)),
    );
}

async function expectNoScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return {
      down: root.scrollHeight - window.innerHeight,
      across: root.scrollWidth - window.innerWidth,
    };
  });
  expect(overflow.down).toBeLessThanOrEqual(0);
  expect(overflow.across).toBeLessThanOrEqual(0);
}

async function expectInView(page: Page, name: string) {
  const button = await page.getByRole("button", { name }).boundingBox();
  const size = page.viewportSize();
  expect(button).not.toBeNull();
  expect((button?.y ?? 0) + (button?.height ?? 0)).toBeLessThanOrEqual(
    size?.height ?? 0,
  );
}

test("1440x900: side by side", async ({ page }) => {
  await openStart(page, 1440, 900);

  const modes = await box(page, ".start-modes");
  const clock = await box(page, ".start-clock");
  expect(modes.x + modes.width).toBeLessThanOrEqual(clock.x);
  const tops = await radioTops(page);
  expect(tops[0]).toBeLessThan(tops[1]);
  await expect(page.getByRole("button", { name: "Tasks" })).toBeVisible();
  await expectNoScroll(page);
});

test("900x800: stacked, the mode rows above the timer", async ({ page }) => {
  await openStart(page, 900, 800);

  const modes = await box(page, ".start-modes");
  const clock = await box(page, ".start-clock");
  expect(modes.y + modes.height).toBeLessThanOrEqual(clock.y);
  const tops = await radioTops(page);
  expect(tops[0]).toBeLessThan(tops[1]);
  expect(tops[1]).toBeLessThan(tops[2]);
  await expectInView(page, "Start");
  await expectNoScroll(page);
});

test("420x520: chips, the header menu, and no scroll", async ({ page }) => {
  await openStart(page, 420, 520);

  const tops = await radioTops(page);
  expect(new Set(tops).size).toBe(1);
  await expect(page.getByRole("button", { name: "Tasks" })).toBeHidden();
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Tasks" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expectInView(page, "Start");
  await expectInView(page, "Take a break");
  await expectNoScroll(page);

  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("timer", { name: "Time left" })).toBeVisible();
  await expectInView(page, "Pause");
  await expectNoScroll(page);
});

// README rule 9, second pass: one scale keeps the boards' ratios.
async function expectBoardRatio(page: Page) {
  const digits = await box(page, ".start-time");
  const cta = await box(page, ".screen-cta");
  // On the boards the START plate is 72px and the digit box 132px.
  expect(digits.height).toBeGreaterThan(cta.height);
  expect(cta.height).toBeLessThanOrEqual(
    Math.max(40, (72 / 132) * digits.height) + 1,
  );
}

async function expectNoOverlap(page: Page) {
  const actions = await box(page, ".start-actions");
  const strip = await page.locator(".task-strip").boundingBox();
  // The START ledge sits under the plate.
  expect(actions.y + actions.height + 8).toBeLessThanOrEqual(
    strip?.y ?? page.viewportSize()?.height ?? 0,
  );
  const header = await box(page, ".screen-header");
  const middle = await box(page, ".start-layout > :visible");
  expect(header.y + header.height).toBeLessThanOrEqual(middle.y);
}

async function expectRunningWithoutPlateOrBar(page: Page) {
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("timer", { name: "Time left" })).toBeVisible();
  await expect(page.locator(".start-mode-plate")).toBeHidden();
  await expect(page.getByRole("progressbar")).toBeHidden();
  await expectBoardRatio(page);
  await expectNoOverlap(page);
  await expectNoScroll(page);
}

for (const [width, height] of [
  [420, 520],
  [1000, 500],
  [1200, 420],
]) {
  test(`${width}x${height}: the timer stays the largest, and nothing overlaps`, async ({
    page,
  }) => {
    await openStart(page, width, height);

    // The chips step: the wordmark and the task line go, the menu stays.
    await expect(page.locator(".screen-brand")).toBeHidden();
    await expect(page.locator(".task-strip")).toBeHidden();
    await expectBoardRatio(page);
    await expectNoOverlap(page);
    await expectNoScroll(page);
    await expectRunningWithoutPlateOrBar(page);
  });
}

test("1440x900: the board sizes hold, with the plate and the bar on Running", async ({
  page,
}) => {
  await openStart(page, 1440, 900);

  await expect(page.locator(".screen-brand")).toBeVisible();
  expect((await box(page, ".start-time")).height).toBeCloseTo(132, 0);
  expect((await box(page, ".screen-cta")).height).toBeCloseTo(72, 0);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".start-mode-plate")).toBeVisible();
  await expect(page.getByRole("progressbar")).toBeVisible();
});

test("400x260: the chips go before the timer drops below 64px", async ({
  page,
}) => {
  await openStart(page, 400, 260);

  await expect(page.getByRole("radio", { name: "Deep Focus" })).toBeHidden();
  expect((await box(page, ".start-time")).height).toBeGreaterThanOrEqual(64);
  await expectBoardRatio(page);
  await expectNoScroll(page);
});

test("280x420: the steps go before the timer drops below 64px", async ({
  page,
}) => {
  await openStart(page, 280, 420);

  await expect(
    page.getByRole("button", { name: "Five minutes more" }),
  ).toBeHidden();
  expect((await box(page, ".start-time")).height).toBeGreaterThanOrEqual(64);
  await expectNoScroll(page);
});
