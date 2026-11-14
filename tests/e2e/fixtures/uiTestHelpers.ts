import { fireEvent, screen } from "@testing-library/react";

/**
 * Opaque-box filter helper that works whether the UI renders a <select>
 * dropdown or chip/button controls.
 */
export function selectFilterOption(
  labelPattern: RegExp,
  optionValue: string,
  buttonNamePattern: RegExp,
): void {
  const select =
    screen.queryByLabelText(labelPattern) ??
    screen.queryByRole("combobox", { name: labelPattern });
  if (select instanceof HTMLSelectElement) {
    fireEvent.change(select, { target: { value: optionValue } });
    return;
  }
  fireEvent.click(screen.getByRole("button", { name: buttonNamePattern }));
}
