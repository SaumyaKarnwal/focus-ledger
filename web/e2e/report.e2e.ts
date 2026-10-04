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
