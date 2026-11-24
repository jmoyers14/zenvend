import { describe, expect, test } from "bun:test";
import {
  activeProductsByName,
  buildComboboxEntries,
  type ProductOption,
} from "./productCombobox.ts";

const product = (name: string, { active = true } = {}): ProductOption => ({
  id: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  defaultPriceCents: 0,
  active,
});

const PRODUCTS = activeProductsByName([
  product("Diet Coke"),
  product("Coke Zero"),
  product("Animal Crackers"),
  product("Old Cola", { active: false }),
]);

const names = (entries: ReturnType<typeof buildComboboxEntries>) =>
  entries.map((entry) => (entry.kind === "product" ? entry.product.name : "+new"));

describe("activeProductsByName", () => {
  test("drops inactive products and sorts the rest A–Z", () => {
    expect(PRODUCTS.map((p) => p.name)).toEqual([
      "Animal Crackers",
      "Coke Zero",
      "Diet Coke",
    ]);
  });
});

describe("buildComboboxEntries", () => {
  test("lists every product for an empty search", () => {
    const entries = buildComboboxEntries(PRODUCTS, {
      searchTerm: "",
      offersNewProduct: false,
    });
    expect(names(entries)).toEqual(["Animal Crackers", "Coke Zero", "Diet Coke"]);
  });

  test("ranks matches for a search", () => {
    const entries = buildComboboxEntries(PRODUCTS, {
      searchTerm: "co",
      offersNewProduct: false,
    });
    expect(names(entries)).toEqual(["Coke Zero", "Diet Coke"]);
  });

  test("puts New product after the matches so the best match stays first", () => {
    const entries = buildComboboxEntries(PRODUCTS, {
      searchTerm: "coke",
      offersNewProduct: true,
    });
    expect(names(entries)).toEqual(["Coke Zero", "Diet Coke", "+new"]);
  });

  test("leaves New product as the only entry when nothing matches", () => {
    const entries = buildComboboxEntries(PRODUCTS, {
      searchTerm: "doritos",
      offersNewProduct: true,
    });
    expect(names(entries)).toEqual(["+new"]);
  });
});
