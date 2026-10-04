import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useBarFocus } from "./useBarFocus";

function Chart() {
  const { active, barProps } = useBarFocus();
  return (
    <>
      <ol>
        {["Mon", "Tue", "Wed"].map((label, index) => (
          <li key={label} aria-label={label} {...barProps(index)} />
        ))}
      </ol>
      <output>{active === undefined ? "none" : active}</output>
    </>
  );
}

const bar = (name: string) => screen.getByRole("listitem", { name });
const shown = () => screen.getByRole("status").textContent;

describe("useBarFocus (README Report and task page polish 5)", () => {
  test("useBarFocus_atRest_noBarIsActiveAndNoneFades", () => {
    render(<Chart />);

    expect(shown()).toBe("none");
    expect(
      screen.getAllByRole("listitem").map((item) => item.dataset.dim),
    ).toEqual(["false", "false", "false"]);
  });

  test("useBarFocus_hover_activatesTheBarAndFadesTheOthers", () => {
    render(<Chart />);

    fireEvent.mouseEnter(bar("Tue"));
    expect(shown()).toBe("1");
    expect(bar("Mon").dataset.dim).toBe("true");
    expect(bar("Tue").dataset.dim).toBe("false");
    fireEvent.mouseLeave(bar("Tue"));
    expect(shown()).toBe("none");
  });

  test("useBarFocus_keyboardFocus_activatesTheBar", () => {
    render(<Chart />);

    expect(bar("Wed").tabIndex).toBe(0);
    fireEvent.focus(bar("Wed"));
    expect(shown()).toBe("2");
    fireEvent.blur(bar("Wed"));
    expect(shown()).toBe("none");
  });

  test("useBarFocus_tap_togglesTheBar", () => {
    render(<Chart />);

    fireEvent.click(bar("Mon"));
    expect(shown()).toBe("0");
    fireEvent.click(bar("Mon"));
    expect(shown()).toBe("none");
  });
});
