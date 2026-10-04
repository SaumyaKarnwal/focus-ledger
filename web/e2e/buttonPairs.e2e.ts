import { expect, type Page, test } from "@playwright/test";

// README rule 11: the two buttons of a pair have the same 6px ledge and one
// center line. The outline is a little larger than the plate (#225): an
// outline looks smaller than a filled plate of the same size.

async function open(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  // The fake backend runs in the page. Nothing may leave the local server.
  await page.route("**/*", (route) =>
    route.request().url().startsWith("http://localhost:")
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/?backend=fake&fixture=today");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function expectMatchedPair(
  page: Page,
  primary: string,
  secondary: RegExp | string,
) {
  const boxOf = async (name: RegExp | string) => {
    const button = page.getByRole("button", { name });
    const box = await button.boundingBox();
    const ledge = await button.evaluate(
      (element) =>
        /0px (\d+(?:\.\d+)?)px 0px 0px/.exec(
          getComputedStyle(element).boxShadow,
        )?.[1],
    );
    if (!box) throw new Error(`no box for ${String(name)}`);
    return { ...box, ledge };
  };
  const first = await boxOf(primary);
  const second = await boxOf(secondary);
  // The plate is 230 board pixels wide, with no floor, so it gives the scale.
  const unit = first.width / 230;

  expect(first.height).toBeCloseTo(Math.max(40, 72 * unit), 0);
  expect(second.width).toBeCloseTo(238 * unit, 0);
  expect(second.height).toBeCloseTo(Math.max(40, 78 * unit), 0);
  expect(second.y + second.height / 2).toBeCloseTo(
    first.y + first.height / 2,
    0,
  );
  expect(first.ledge).toBe("6");
  expect(second.ledge).toBe("6");
}

for (const [width, height] of [
  [1440, 900],
  [420, 520],
]) {
  test(`${width}x${height}: each button pair matches`, async ({ page }) => {
    await open(page, width, height);

    await expectMatchedPair(page, "Start", "Take a break");

    await page.getByRole("button", { name: "Take a break" }).click();
    await expectMatchedPair(page, "Start the break", "Start a cycle");

    await page.getByRole("button", { name: "Start the break" }).click();
    await expectMatchedPair(page, "+5 min", "Start a cycle");

    await page.getByRole("button", { name: "Start a cycle" }).click();
    await page.getByRole("button", { name: "Start" }).click();
    await expectMatchedPair(page, "Pause", /Stop and log/);
  });
}
