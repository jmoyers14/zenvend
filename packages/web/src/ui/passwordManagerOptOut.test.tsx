import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MachineMap } from "./MachineMap.tsx";
import { DecimalInput, MoneyInput, NumberInput } from "./NumberInput.tsx";
import { SearchInput } from "./SearchInput.tsx";
import { TextArea, TextInput } from "./TextInput.tsx";

const optOutAttributes = [
  'data-1p-ignore="true"',
  'data-lpignore="true"',
  'data-bwignore="true"',
  'data-form-type="other"',
  'data-protonpass-ignore="true"',
];

const controls: Record<string, ReactElement> = {
  TextInput: <TextInput />,
  TextArea: <TextArea />,
  NumberInput: <NumberInput />,
  DecimalInput: <DecimalInput />,
  MoneyInput: <MoneyInput />,
  SearchInput: <SearchInput value="" onChange={() => {}} placeholder="Find" />,
  "MachineMap search": (
    <MachineMap
      shelves={[["A1"]]}
      tileFor={() => ({ label: "A1", value: 3 })}
      search={{ label: "Find a slot", placeholder: "A1" }}
    />
  ),
};

describe("shared text controls", () => {
  test.each(Object.entries(controls))("%s opts out of every password manager", (_, control) => {
    const markup = renderToStaticMarkup(control);

    for (const attribute of optOutAttributes) {
      expect(markup).toContain(attribute);
    }
  });

  test("a caller can override an opt-out", () => {
    const markup = renderToStaticMarkup(<TextInput data-form-type="address" />);

    expect(markup).toContain('data-form-type="address"');
    expect(markup).not.toContain('data-form-type="other"');
  });
});
