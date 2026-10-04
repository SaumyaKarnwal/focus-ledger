import { fireEvent, screen, within } from "@testing-library/react";

/** The Sound picker button in a Settings card ("The bell" or "Focus sound"). */
export function soundPicker(card: string) {
  return within(screen.getByRole("region", { name: card })).getByRole(
    "button",
    { name: /^Sound / },
  );
}

/** Opens the card's Sound picker and clicks an option. */
export function pickSound(card: string, label: string) {
  fireEvent.click(soundPicker(card));
  fireEvent.click(
    within(screen.getByRole("listbox")).getByRole("option", { name: label }),
  );
}
