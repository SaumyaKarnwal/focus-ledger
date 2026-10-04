import { expect, type Page, test } from "@playwright/test";

// README rule 11: the two buttons of a pair have the same width, plate, and
// 6px ledge, with aligned edges; only the fill and the label weight differ.

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

async function expectEqualPair(
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

  expect(second.width).toBeCloseTo(first.width, 0);
  expect(second.height).toBeCloseTo(first.height, 0);
  expect(second.y).toBeCloseTo(first.y, 0);
  expect(second.y + second.height).toBeCloseTo(first.y + first.height, 0);
  expect(first.ledge).toBe("6");
  expect(second.ledge).toBe("6");
}

for (const [width, height] of [
  [1440, 900],
  [420, 520],
]) {
  test(`${width}x${height}: each button pair is equal`, async ({ page }) => {
    await open(page, width, height);

    await expectEqualPair(page, "Start", "Take a break");

    await page.getByRole("button", { name: "Take a break" }).click();
    await expectEqualPair(page, "Start the break", "Start a cycle");

    await page.getByRole("button", { name: "Start a cycle" }).click();
    await page.getByRole("button", { name: "Start" }).click();
    await expectEqualPair(page, "Pause", /Stop and log/);
  });
}
