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
