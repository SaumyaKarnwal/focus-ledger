import { expect, type Page, test } from "@playwright/test";

// README "Report and task page polish": checks that need real CSS.

async function openReport(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1500 });
  // The fake backend runs in the page. Nothing may leave the local server.
  await page.route("**/*", (route) =>
    route.request().url().startsWith("http://localhost:")
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/report?backend=fake&fixture=today");
  await expect(
    page.getByRole("heading", { name: "This week", level: 1 }),
  ).toBeVisible();
  // A font that loads late changes the widths that the checks measure.
  await page.evaluate(() => document.fonts.ready);
}

test("What you set: the set mark is the quiet grey, not black", async ({
  page,
}) => {
  await openReport(page);

  const colors = await page
    .getByRole("region", { name: "What you set, what you do" })
    .evaluate((card) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--ink-muted)";
      card.append(probe);
      const muted = getComputedStyle(probe).color;
      probe.remove();
      return {
        muted,
        marks: [...card.querySelectorAll(".report-set-mark")].map(
          (mark) => getComputedStyle(mark).backgroundColor,
        ),
      };
    });

  expect(colors.marks.length).toBeGreaterThan(0);
  colors.marks.forEach((mark) => expect(mark).toBe(colors.muted));
});

// README "Report range arrows stay put": the ‹ › pair comes before the title,
// so a title of any width never moves it.
test("the range arrows stay put between Today, Yesterday, and an older day, and between two weeks", async ({
  page,
}) => {
  await openReport(page);
  const heading = page.locator("h1.report-heading");
  const arrowsAt = async () => {
    const earlier = await page
      .getByRole("button", { name: "Earlier" })
      .boundingBox();
    const later = await page
      .getByRole("button", { name: "Later" })
      .boundingBox();
    if (!earlier || !later) throw new Error("no arrows");
    return [earlier.x, later.x];
  };
  const stepBack = async () => {
    const before = (await heading.textContent()) ?? "";
    await page.getByRole("button", { name: "Earlier" }).click();
    await expect(heading).not.toHaveText(before);
  };

  const thisWeek = await arrowsAt();
  await stepBack();
  await expect(heading).toHaveText("Last week");
  expect(await arrowsAt()).toEqual(thisWeek);

  await page
    .getByRole("group", { name: "Range" })
    .getByRole("button", { name: "Today" })
    .click();
  await expect(heading).toHaveText("Today");
  const today = await arrowsAt();
  await stepBack();
  await expect(heading).toHaveText("Yesterday");
  expect(await arrowsAt()).toEqual(today);
  await stepBack();
  await expect(heading).toHaveText(/^\w{3} \d{1,2} \w{3}$/);
  expect(await arrowsAt()).toEqual(today);

  // The title starts 16px after the arrows.
  const steps = await page.locator(".report-steps").boundingBox();
  const title = await heading.boundingBox();
  if (!steps || !title) throw new Error("no boxes");
  expect(title.x - (steps.x + steps.width)).toBeCloseTo(16, 0);
});
