import { expect, type Page, test } from "@playwright/test";

// README "Log time": the dialog has one fixed size (580 × 500). Nothing inside
// it moves or resizes it: not the task picker, the calendar, or the counts.

async function openLogTime(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The fake backend runs in the page. Nothing may leave the local server.
  await page.route("**/*", (route) =>
    route.request().url().startsWith("http://localhost:")
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/tasks?backend=fake&fixture=today");
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("button", { name: "Log time" }).click();
  return page.getByRole("dialog", { name: "Log time" });
}

test("Log time keeps one size with the picker, the calendar, and the counts", async ({
  page,
}) => {
  const dialog = await openLogTime(page);
  const size = async () => {
    const box = await dialog.boundingBox();
    if (!box) throw new Error("no dialog");
    return [box.x, box.y, box.width, box.height];
  };
  const atRest = await size();
  expect(atRest.slice(2)).toEqual([580, 500]);

  await page.getByRole("button", { name: /^Task: / }).click();
  await expect(
    page.getByRole("combobox", { name: /search tasks/i }),
  ).toBeVisible();
  expect(await size()).toEqual(atRest);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /^When/ }).click();
  await page.getByRole("textbox", { name: "Start time" }).fill("3:30");
  await page.getByRole("button", { name: "pm" }).click();
  expect(await size()).toEqual(atRest);
  await page.keyboard.press("Escape");

  await page
    .getByRole("button", { name: "Deep Focus cycles: One cycle more" })
    .click();
  await page
    .getByRole("button", { name: "Execution cycles: One cycle more" })
    .click();
  expect(await size()).toEqual(atRest);
  await expect(page.getByRole("button", { name: /^When/ })).toContainText(
    "3:30 pm",
  );
});
