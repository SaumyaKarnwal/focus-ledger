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

// README "Report range arrows stay put": the ‹ › pair ends the header row.
test("the range arrows stay put between Today and Yesterday, and between two weeks", async ({
  page,
}) => {
  await openReport(page);
  const heading = page.locator(".report-heading");
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

  const steps = await page.locator(".report-steps").boundingBox();
  const card = await page
    .getByRole("region", { name: "When you focus" })
    .boundingBox();
  if (!steps || !card) throw new Error("no boxes");
  expect(steps.x + steps.width).toBeCloseTo(card.x + card.width, 0);
});
