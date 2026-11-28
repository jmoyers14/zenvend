import { describe, expect, test } from "bun:test";
import { errorsWithout, isNewlyShown } from "./formErrors.ts";

interface Draft {
  name: string;
  price: string;
  notes: string;
}

describe("errorsWithout", () => {
  test("drops the given keys and keeps the rest", () => {
    const errors = { name: "Enter a name", price: "Enter a price" };

    const next = errorsWithout<Draft>(errors, ["name"]);

    expect(next).toEqual({ price: "Enter a price" });
  });

  test("ignores keys that have no error", () => {
    const errors = { name: "Enter a name" };

    const next = errorsWithout<Draft>(errors, ["notes", "price"]);

    expect(next).toEqual({ name: "Enter a name" });
  });

  test("leaves the input untouched", () => {
    const errors = { name: "Enter a name" };

    errorsWithout<Draft>(errors, ["name"]);

    expect(errors).toEqual({ name: "Enter a name" });
  });
});

describe("isNewlyShown", () => {
  test("is true when a message replaces nothing", () => {
    expect(isNewlyShown({ previous: null, current: "Name taken" })).toBe(true);
  });

  test("is false when a message stays", () => {
    expect(isNewlyShown({ previous: "Name taken", current: "Name taken" })).toBe(false);
  });

  test("is false when one message replaces another", () => {
    expect(isNewlyShown({ previous: "Name taken", current: "Server down" })).toBe(false);
  });

  test("is false when the message clears", () => {
    expect(isNewlyShown({ previous: "Name taken", current: null })).toBe(false);
  });
});
