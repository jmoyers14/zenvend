import { describe, expect, it } from "bun:test";
import { slotProductKey } from "@zenvend/domain";
import {
  buildRestock,
  restockWithAction,
  restockWithArrivalChange,
  restockWithNewStock,
  restockWithSwap,
} from "./restock.ts";
import { isSlotAnswered } from "./restockSlots.ts";
import {
  type Departure,
  departureLabelFor,
  isTakeOutAsked,
  rowActionsFor,
  type SlotItem,
  slotContentLabelFor,
  slotContentsFor,
} from "./slotContents.ts";
import { buildVisitRows, type VisitRow } from "./visitRows.ts";

const SHELVES = [["A1", "A2", "A3", "B1"]];

const PLANOGRAM_SLOTS = [
  { slotCode: "A1", productId: "coke", par: 10, priceCents: 175 },
  { slotCode: "A2", productId: "doritos", par: 10, priceCents: 150 },
  { slotCode: "A2", productId: "lays", par: 10, priceCents: 150 },
  { slotCode: "B1", productId: "water", par: 10, priceCents: 100 },
];

const PRODUCTS = [
  { id: "coke", tracksExpiration: false },
  { id: "doritos", tracksExpiration: false },
  { id: "lays", tracksExpiration: false },
  { id: "water", tracksExpiration: false },
];

const buildRows = (left: Record<string, string> = {}): VisitRow[] =>
  buildVisitRows({
    shelves: SHELVES,
    planogramSlots: PLANOGRAM_SLOTS,
    previousVisit: null,
    products: PRODUCTS,
  }).map((row) => ({ ...row, left: left[slotProductKey(row)] ?? "4" }));

const rowFor = (rows: readonly VisitRow[], slotCode: string, productId: string) => {
  const found = rows.find(
    (row) => row.slotCode === slotCode && row.productId === productId,
  );
  if (!found) {
    throw new Error(`no row ${slotCode}/${productId}`);
  }
  return found;
};

const withRow = (rows: VisitRow[], target: VisitRow, patch: Partial<VisitRow>) =>
  rows.map((row) => (row === target ? { ...row, ...patch } : row));

const expiredPull = { removed: "2", removedReason: "expired" } as const;

const counted = (rows: VisitRow[], slotCode: string) => {
  const slotContents = slotContentsFor({
    rows,
    restock: buildRestock({ shelves: SHELVES, rows }),
    slotCode,
  });
  return slotContents.items[0] as Extract<SlotItem, { kind: "counted" }>;
};

describe("slotContentsFor", () => {
  it("lists staying products front to back, then arrivals", () => {
    const rows = buildRows();
    const restock = restockWithAction(
      buildRestock({ shelves: SHELVES, rows }),
      rowFor(rows, "A2", "doritos"),
      { kind: "added", added: "3" },
    );

    const { items } = slotContentsFor({ rows, restock, slotCode: "A2" });

    expect(items.map((item) => item.productId)).toEqual(["doritos", "lays"]);
    expect(items.map((item) => item.count)).toEqual([7, 4]);
    expect(items.map((item) => item.isAnswered)).toEqual([true, false]);
  });

  it("drops a moved product and lists it as a departure", () => {
    const rows = buildRows();
    const restock = restockWithAction(
      buildRestock({ shelves: SHELVES, rows }),
      rowFor(rows, "A1", "coke"),
      { kind: "moved", toSlotCode: "B1", isSwap: false },
    );

    const source = slotContentsFor({ rows, restock, slotCode: "A1" });
    const destination = slotContentsFor({ rows, restock, slotCode: "B1" });

    expect(source.items).toEqual([]);
    expect(source.departures).toHaveLength(1);
    expect(source.departures[0]?.action.kind).toBe("moved");
    expect(destination.items.at(-1)).toMatchObject({
      kind: "arrival",
      productId: "coke",
      movedUnits: 4,
      count: 4,
      isSwap: false,
      isAnswered: true,
    });
  });

  it("keeps departures when every product left", () => {
    const rows = buildRows();
    let restock = buildRestock({ shelves: SHELVES, rows });
    for (const productId of ["doritos", "lays"]) {
      restock = restockWithAction(restock, rowFor(rows, "A2", productId), {
        kind: "moved",
        toSlotCode: "B1",
        isSwap: false,
      });
    }

    const slotContents = slotContentsFor({ rows, restock, slotCode: "A2" });

    expect(slotContents.items).toEqual([]);
    expect(slotContents.departures).toHaveLength(2);
    expect(isSlotAnswered({ rows, restock, slotCode: "A2" })).toBe(true);
  });

  it("puts only the swapped partner at the back of each slot", () => {
    const rows = buildRows();
    const restock = restockWithSwap(buildRestock({ shelves: SHELVES, rows }), {
      a: rowFor(rows, "A1", "coke"),
      b: rowFor(rows, "A2", "lays"),
    });

    const mixed = slotContentsFor({ rows, restock, slotCode: "A2" });
    const single = slotContentsFor({ rows, restock, slotCode: "A1" });

    expect(mixed.items.map((item) => item.productId)).toEqual(["doritos", "coke"]);
    expect(mixed.items[1]).toMatchObject({ kind: "arrival", isSwap: true });
    expect(single.items.map((item) => item.productId)).toEqual(["lays"]);
  });

  it("counts a partial pull", () => {
    const base = buildRows({ [slotProductKey({ slotCode: "A1", productId: "coke" })]: "5" });
    const rows = withRow(base, rowFor(base, "A1", "coke"), {
      removed: "2",
      removedReason: "expired",
    });

    expect(counted(rows, "A1")).toMatchObject({ count: 3, isAnswered: true });
  });

  it("leaves an uncounted row out of both lists", () => {
    const rows = buildRows({
      [slotProductKey({ slotCode: "A2", productId: "lays" })]: "",
    });
    const restock = buildRestock({ shelves: SHELVES, rows });

    const slotContents = slotContentsFor({ rows, restock, slotCode: "A2" });

    expect(slotContents.items.map((item) => item.productId)).toEqual(["doritos"]);
    expect(slotContents.departures).toEqual([]);
  });
});

describe("slotContentLabelFor", () => {
  const cokeItem = (patch: Partial<VisitRow>, added?: string) => {
    const base = buildRows();
    const rows = withRow(base, rowFor(base, "A1", "coke"), patch);
    let restock = buildRestock({ shelves: SHELVES, rows });
    if (added !== undefined) {
      restock = restockWithAction(restock, rowFor(rows, "A1", "coke"), {
        kind: "added",
        added,
      });
    }
    const [item] = slotContentsFor({ rows, restock, slotCode: "A1" }).items;
    if (!item) {
      throw new Error("no item");
    }
    return item;
  };

  it("says what was counted while unanswered", () => {
    expect(slotContentLabelFor(cokeItem({}))).toBe("Counted 4");
  });

  it("labels the answers a counted product can have", () => {
    expect(slotContentLabelFor(cokeItem({}, "0"))).toBe("✓ Nothing changed");
    expect(slotContentLabelFor(cokeItem({}, "8"))).toBe("✓ +8");
    expect(slotContentLabelFor(cokeItem(expiredPull))).toBe("✓ Pulled 2 expired");
    expect(slotContentLabelFor(cokeItem(expiredPull, "8"))).toBe(
      "✓ Pulled 2 expired · +8",
    );
    expect(slotContentLabelFor(cokeItem(expiredPull, "0"))).toBe(
      "✓ Pulled 2 expired",
    );
  });

  const arrivalItem = (
    options: { isSwap?: boolean; added?: string; fromSlotCode?: string | null },
  ) => {
    const rows = buildRows();
    let restock = buildRestock({ shelves: SHELVES, rows });
    const fromSlotCode = options.fromSlotCode === undefined ? "A1" : options.fromSlotCode;
    if (fromSlotCode === null) {
      restock = restockWithNewStock(restock, {
        slotCode: "B1",
        productId: "coke",
        tracksExpiration: false,
      });
    } else if (options.isSwap) {
      restock = restockWithSwap(restock, {
        a: rowFor(rows, "A1", "coke"),
        b: rowFor(rows, "B1", "water"),
      });
    } else {
      restock = restockWithAction(restock, rowFor(rows, "A1", "coke"), {
        kind: "moved",
        toSlotCode: "B1",
        isSwap: false,
      });
    }
    if (options.added !== undefined) {
      restock = restockWithArrivalChange(
        restock,
        { slotCode: "B1", productId: "coke" },
        { added: options.added },
      );
    }
    const item = slotContentsFor({ rows, restock, slotCode: "B1" }).items.find(
      (candidate) => candidate.productId === "coke",
    );
    if (!item) {
      throw new Error("no arrival");
    }
    return item;
  };

  it("labels arrivals by where they came from", () => {
    expect(slotContentLabelFor(arrivalItem({}))).toBe("↳ From A1");
    expect(slotContentLabelFor(arrivalItem({ added: "9" }))).toBe("↳ From A1 · +5 new");
    expect(slotContentLabelFor(arrivalItem({ isSwap: true }))).toBe("⇄ From A1");
    expect(slotContentLabelFor(arrivalItem({ fromSlotCode: null, added: "6" }))).toBe(
      "New · +6",
    );
  });

  it("labels a new arrival without a count as New", () => {
    expect(slotContentLabelFor(arrivalItem({ fromSlotCode: null }))).toBe("New");
  });
});

describe("departureLabelFor", () => {
  const nameOf = (id: string) => (id === "coke" ? "Coke" : id);
  const row = rowFor(buildRows(), "A1", "coke");
  const departure = (action: Departure["action"]): Departure => ({
    key: slotProductKey(row),
    row,
    action,
  });

  it("names where a product went or why it left", () => {
    expect(
      departureLabelFor(departure({ kind: "moved", toSlotCode: "B1", isSwap: false }), { nameOf }),
    ).toBe("Coke → B1");
    expect(
      departureLabelFor(departure({ kind: "moved", toSlotCode: "B1", isSwap: true }), { nameOf }),
    ).toBe("Coke ⇄ B1");
    expect(
      departureLabelFor(departure({ kind: "pulled", reason: "expired" }), { nameOf }),
    ).toBe("Coke · taken out, expired");
  });
});

describe("rowActionsFor", () => {
  it("offers every action on a counted row", () => {
    const rows = buildRows();
    const item = counted(rows, "A1");

    expect(rowActionsFor(item)).toEqual([
      "add-stock",
      "move",
      "swap",
      "pull",
      "nothing-changed",
    ]);
  });

  it("omits Pull for a row counted at 0", () => {
    const base = buildRows();
    const rows = withRow(base, rowFor(base, "A1", "coke"), { left: "0" });

    expect(rowActionsFor(counted(rows, "A1"))).toEqual([
      "add-stock",
      "move",
      "swap",
      "nothing-changed",
    ]);
  });

  it("edits the pull instead of offering move, swap or pull", () => {
    const base = buildRows();
    const rows = withRow(base, rowFor(base, "A1", "coke"), expiredPull);

    expect(rowActionsFor(counted(rows, "A1"))).toEqual([
      "add-stock",
      "edit-pull",
      "nothing-changed",
    ]);
  });

  it("lets a moved arrival be undone and a new one removed", () => {
    const rows = buildRows();
    const start = buildRestock({ shelves: SHELVES, rows });
    const moved = restockWithAction(start, rowFor(rows, "A1", "coke"), {
      kind: "moved",
      toSlotCode: "B1",
      isSwap: false,
    });
    const stocked = restockWithNewStock(start, {
      slotCode: "B1",
      productId: "coke",
      tracksExpiration: false,
    });
    const movedItem = slotContentsFor({ rows, restock: moved, slotCode: "B1" }).items.at(-1);
    const newItem = slotContentsFor({ rows, restock: stocked, slotCode: "B1" }).items.at(-1);

    expect(movedItem && rowActionsFor(movedItem)).toEqual(["add-stock", "undo-move"]);
    expect(newItem && rowActionsFor(newItem)).toEqual(["add-stock", "remove"]);
  });
});

describe("isTakeOutAsked", () => {
  const rows = buildRows();
  const item = counted(rows, "A1");
  const start = buildRestock({ shelves: SHELVES, rows });

  it("is true when the quantity is everything counted", () => {
    expect(isTakeOutAsked({ item, restock: start, quantity: 4 })).toBe(true);
    expect(isTakeOutAsked({ item, restock: start, quantity: 3 })).toBe(false);
  });

  it("is false when the row already has Add stock", () => {
    const restock = restockWithAction(start, item.row, { kind: "added", added: "8" });

    expect(isTakeOutAsked({ item, restock, quantity: 4 })).toBe(false);
  });
});
