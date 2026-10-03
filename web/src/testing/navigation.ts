import { fireEvent, screen, within } from "@testing-library/react";

/** Opens the Tasks page from the header of any page. */
export async function openTasks() {
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(within(nav).getByRole("button", { name: "Tasks" }));
  await screen.findByRole("list", { name: "Nodes" });
}

/** Opens Report or Settings from the Tasks page header. The Start header has them inert. */
export async function openFromTasks(view: "Report" | "Settings") {
  await openTasks();
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "Views" })).getByRole(
      "button",
      { name: view },
    ),
  );
}

/** Shows the task on Start through Tasks and "Open on Today", with the mode chosen. */
export async function openOnStart(taskName: string, mode?: string) {
  await openTasks();
  const row = await screen.findByRole("listitem", { name: taskName });
  fireEvent.click(row.querySelector('[data-part="name"]') as Element);
  fireEvent.click(
    within(
      screen.getByRole("complementary", { name: "Node detail" }),
    ).getByRole("button", { name: "Open on Today" }),
  );
  await screen.findByRole("button", { name: "Start" });
  if (mode) fireEvent.click(screen.getByRole("radio", { name: mode }));
}

/** Presses START on the Start screen and waits for the running clock. */
export async function pressStart() {
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByRole("timer", { name: "Time left" });
}

export async function startCycleOn(taskName: string, mode?: string) {
  await openOnStart(taskName, mode);
  await pressStart();
}
