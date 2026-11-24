import { describe, expect, it } from "bun:test";
import { slotProductKey } from "@zenvend/domain";
import { buildRestock } from "./restock.ts";
import { buildVisitRows, type VisitRow } from "./visitRows.ts";
import { buildTooltip, countTileFor, restockTileFor } from "./visitTiles.ts";

const SHELVES = [["A1", "A2"]];

const PLANOGRAM_SLOTS = [
  { slotCode: "A1", productId: "coke", par: 10, priceCents: 175 },
  { slotCode: "A2", productId: "doritos", par: 10, priceCents: 150 },
  { slotCode: "A2", productId: "lays", par: 10, priceCents: 150 },
];

const PRODUCTS = [
  { id: "coke", tracksExpiration: false },
  { id: "doritos", tracksExpiration: false },
  { id: "lays", tracksExpiration: false },
];

const NAMES: Record<string, string> = { coke: "Coke", doritos: "Doritos", lays: "Lay's" };
const nameOf = (productId: string) => NAMES[productId] ?? productId;

const buildRows = (left: Record<string, string> = {}): VisitRow[] =>
  buildVisitRows({
    shelves: SHELVES,
    planogramSlots: PLANOGRAM_SLOTS,
    previousVisit: null,
    products: PRODUCTS,
  }).map((row) => ({ ...row, left: left[slotProductKey(row)] ?? "" }));

describe("buildTooltip", () => {
  it("puts the heading first, then one bulleted product per line", () => {
    const tooltip = buildTooltip({ heading: "A2 · 4 in slot", productNames: ["Doritos", "Lay's"] });

    expect(tooltip).toBe("A2 · 4 in slot\n• Doritos\n• Lay's");
  });
});

describe("restockTileFor", () => {
  it("lists a mixed slot's products as bullets under its status", () => {
    const rows = buildRows();
    const restock = buildRestock({ shelves: SHELVES, rows });

    const tile = restockTileFor({ rows, restock, slotCode: "A2", nameOf, needsAttention: false });

    expect(tile.tooltip?.split("\n").slice(1)).toEqual(["• Doritos", "• Lay's"]);
    expect(tile.tooltip?.split("\n")[0]).toStartWith("A2 · ");
  });

  it("keeps the accessible label on one line, without bullets", () => {
    const rows = buildRows();
    const restock = buildRestock({ shelves: SHELVES, rows });

    const tile = restockTileFor({ rows, restock, slotCode: "A2", nameOf, needsAttention: true });

    expect(tile.label).not.toContain("\n");
    expect(tile.label).toContain("Doritos, Lay's");
    expect(tile.label).toEndWith("needs a look");
  });
});

describe("countTileFor", () => {
  it("bullets the products under the count", () => {
    const rows = buildRows({
      [slotProductKey({ slotCode: "A2", productId: "doritos" })]: "3",
      [slotProductKey({ slotCode: "A2", productId: "lays" })]: "1",
    });

    const tile = countTileFor({ rows, slotCode: "A2", nameOf });

    expect(tile.tooltip?.split("\n").slice(1)).toEqual(["• Doritos", "• Lay's"]);
  });
});
