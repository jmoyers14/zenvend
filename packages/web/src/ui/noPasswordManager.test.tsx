import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MachineMap } from "./MachineMap.tsx";
import { DecimalInput, MoneyInput, NumberInput } from "./NumberInput.tsx";
import { SearchInput } from "./SearchInput.tsx";
import { TextArea, TextInput } from "./TextInput.tsx";

const OPT_OUT_ATTRIBUTES = [
  'data-1p-ignore="true"',
  'data-lpignore="true"',
  'data-bwignore="true"',
  'data-form-type="other"',
  'data-protonpass-ignore="true"',
];

const controls: [string, ReactElement][] = [
  ["TextInput", <TextInput key="text" />],
  ["TextArea", <TextArea key="area" />],
  ["NumberInput", <NumberInput key="number" />],
  ["DecimalInput", <DecimalInput key="decimal" />],
  ["MoneyInput", <MoneyInput key="money" />],
  [
    "SearchInput",
    <SearchInput key="search" value="" onChange={() => {}} placeholder="Find" />,
  ],
  [
    "MachineMap search",
    <MachineMap
      key="map"
      shelves={[["A1"]]}
      tileFor={() => ({ label: "A1", value: 3 })}
      search={{ label: "Find a slot", placeholder: "A1" }}
    />,
  ],
];

describe("shared text controls", () => {
  test.each(controls)("%s opts out of every password manager", (_, control) => {
    const markup = renderToStaticMarkup(control);

    for (const attribute of OPT_OUT_ATTRIBUTES) {
      expect(markup).toContain(attribute);
    }
  });

  test("a caller can override an opt-out", () => {
    const markup = renderToStaticMarkup(<TextInput data-form-type="address" />);

    expect(markup).toContain('data-form-type="address"');
    expect(markup).not.toContain('data-form-type="other"');
  });
});
