import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { FocusMode } from "../gen/focusledger/v1/model_pb";
import { Pips } from "./Pips";

const { DEEP_FOCUS, EXECUTION } = FocusMode;

test("pips_overTheEstimate_drawADividerAndTheOverCount", () => {
  const { container } = render(
    <Pips
      modes={[DEEP_FOCUS, DEEP_FOCUS, EXECUTION, EXECUTION, EXECUTION]}
      estimated={3}
    />,
  );

  expect(container.querySelectorAll(".pip")).toHaveLength(5);
  expect(container.querySelectorAll(".pip-divider")).toHaveLength(1);
  expect(container.textContent).toBe("2 over");
});

test("pips_withinTheEstimate_drawNoDivider", () => {
  const { container } = render(<Pips modes={[EXECUTION]} estimated={5} />);

  expect(container.querySelectorAll(".pip")).toHaveLength(1);
  expect(container.querySelector(".pip-divider")).toBeNull();
});

test("pips_nextCyclePastTheEstimate_isOpenAfterADivider", () => {
  const { container } = render(
    <Pips modes={[EXECUTION, EXECUTION]} estimated={2} next={EXECUTION} />,
  );

  expect(container.querySelectorAll(".pip-next")).toHaveLength(1);
  expect(container.querySelectorAll(".pip-divider")).toHaveLength(1);
});
