import { fireEvent, screen, within } from "@testing-library/react";

/** Opens the Tasks page from the header of any page. */
export async function openTasks() {
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(within(nav).getByRole("button", { name: "Tasks" }));
  await screen.findByRole("list", { name: "Tasks" });
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

/** Shows the task on Start through the task picker, with the mode chosen. */
export async function openOnStart(taskName: string, mode?: string) {
  if (!screen.queryByRole("button", { name: "Start" })) {
    await openTasks();
    fireEvent.click(screen.getByRole("button", { name: /back to Start/ }));
  }
  await screen.findByRole("button", { name: "Start" });
  fireEvent.click(screen.getByRole("button", { name: /working on/i }));
  const option = within(screen.getByRole("listbox", { name: "Tasks" }))
    .getAllByRole("option")
    .find(
      (candidate) =>
        candidate.querySelector(".picker-name")?.textContent === taskName,
    );
  if (!option) throw new Error(`No task named ${taskName} in the picker`);
  fireEvent.click(option);
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
