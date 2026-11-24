import { slotProductKey } from "@zenvend/domain";
import {
  answeredActionFor,
  type Arrival,
  arrivalsIn,
  type ProductAction,
  type Restock,
  recordedActionFor,
} from "./restock.ts";
import type { RestockSlot } from "./restockSlots.ts";
import { REMOVAL_LABELS } from "./visitActivity.ts";
import {
  hasPartialPull,
  isCounted,
  partialPullOf,
  leftAfterPull,
  parseCount,
  rowsInSlot,
  type VisitRow,
} from "./visitRows.ts";

/**
 * What the Restock slot view shows for one slot: the products in it once
 * Restock is done, the ones that left, and what each row can do. Pure.
 */

export type SlotItem =
  | {
      kind: "counted";
      key: string;
      productId: string;
      row: VisitRow;
      /** Left after the pull plus Added; just left after the pull while unanswered. */
      count: number | null;
      /** Parsed Added; null while unanswered. */
      added: number | null;
      isAnswered: boolean;
    }
  | {
      kind: "arrival";
      key: string;
      productId: string;
      arrival: Arrival;
      /** The counted row it moved from; null for new stock. */
      source: VisitRow | null;
      count: number | null;
      /** The source row's units that came along; null for new stock. */
      moved: number | null;
      isSwap: boolean;
      isAnswered: boolean;
    };

export interface Departure {
  key: string;
  row: VisitRow;
  action: Exclude<ProductAction, { kind: "added" }>;
}

export interface SlotContents {
  /** Counted rows that stay, front to back, then arrivals. */
  items: SlotItem[];
  /** Counted rows that moved, swapped or were taken out. */
  departures: Departure[];
}

export type RowAction =
  | "add-stock"
  | "move"
  | "swap"
  | "pull"
  | "edit-pull"
  | "nothing-changed"
  | "undo-move"
  | "remove";

const countedItemFor = (row: VisitRow, action: ProductAction | undefined): SlotItem => {
  const left = leftAfterPull(row);
  const added = action?.kind === "added" ? parseCount(action.added) : null;
  const isAnswered = added !== null && left !== null;
  return {
    kind: "counted",
    key: slotProductKey(row),
    productId: row.productId,
    row,
    count: isAnswered ? left + added : left,
    added: isAnswered ? added : null,
    isAnswered,
  };
};

const arrivalItemFor = (arrival: Arrival, rows: readonly VisitRow[], restock: Restock): SlotItem => {
  const source =
    rows.find(
      (row) => row.slotCode === arrival.fromSlotCode && row.productId === arrival.productId,
    ) ?? null;
  const sourceAction = source ? recordedActionFor(restock, source) : undefined;
  const count = parseCount(arrival.added);
  return {
    kind: "arrival",
    key: slotProductKey(arrival),
    productId: arrival.productId,
    arrival,
    source,
    count,
    moved: source ? leftAfterPull(source) : null,
    isSwap: sourceAction?.kind === "moved" && sourceAction.isSwap,
    isAnswered: count !== null,
  };
};

export const slotContentsFor = (slot: RestockSlot): SlotContents => {
  const { rows, restock, slotCode } = slot;
  const items: SlotItem[] = [];
  const departures: Departure[] = [];
  for (const row of rowsInSlot(rows, slotCode).filter(isCounted)) {
    const action = answeredActionFor(restock, row);
    if (action === undefined || action.kind === "added") {
      items.push(countedItemFor(row, action));
    } else {
      departures.push({ key: slotProductKey(row), row, action });
    }
  }
  for (const arrival of arrivalsIn(restock, slotCode)) {
    items.push(arrivalItemFor(arrival, rows, restock));
  }
  return { items, departures };
};

const countedLabelFor = (item: Extract<SlotItem, { kind: "counted" }>): string => {
  if (!item.isAnswered) {
    return item.count === null ? "Counted" : `Counted ${item.count}`;
  }
  const pull = partialPullOf(item.row);
  const parts: string[] = [];
  if (pull) {
    parts.push(`Pulled ${pull.count} ${REMOVAL_LABELS[pull.reason]}`);
  }
  if ((item.added ?? 0) > 0) {
    parts.push(`+${item.added}`);
  }
  return `✓ ${parts.length > 0 ? parts.join(" · ") : "Nothing changed"}`;
};

const arrivalLabelFor = (item: Extract<SlotItem, { kind: "arrival" }>): string => {
  const { arrival, count, moved } = item;
  if (arrival.fromSlotCode === null) {
    return count === null ? "New" : `New · +${count}`;
  }
  const origin = `${item.isSwap ? "⇄" : "↳"} From ${arrival.fromSlotCode}`;
  const newUnits = count !== null && moved !== null ? count - moved : 0;
  return newUnits > 0 ? `${origin} · +${newUnits} new` : origin;
};

export const slotContentLabelFor = (item: SlotItem): string =>
  item.kind === "counted" ? countedLabelFor(item) : arrivalLabelFor(item);

export const departureLabelFor = (
  { row, action }: Departure,
  { nameOf }: { nameOf: (productId: string) => string },
): string => {
  const name = nameOf(row.productId);
  if (action.kind === "moved") {
    return `${name} ${action.isSwap ? "⇄" : "→"} ${action.toSlotCode}`;
  }
  return `${name} · taken out, ${REMOVAL_LABELS[action.reason]}`;
};

export const rowActionsFor = (item: SlotItem): RowAction[] => {
  if (item.kind === "arrival") {
    return ["add-stock", item.arrival.fromSlotCode === null ? "remove" : "undo-move"];
  }
  if (hasPartialPull(item.row)) {
    return ["add-stock", "edit-pull", "nothing-changed"];
  }
  const canPull = leftAfterPull(item.row) !== 0;
  return [
    "add-stock",
    "move",
    "swap",
    ...(canPull ? (["pull"] as const) : []),
    "nothing-changed",
  ];
};

/** How Add stock reads for one product: the units the typed number goes on
 *  top of, and the input's starting text. */
export interface AddStockEntry {
  baseCount: number;
  /** The typed number is new units on top of what moved in, not the total. */
  isOnTopOfMove: boolean;
  wentIn: string;
}

export const addStockEntryFor = (item: SlotItem, restock: Restock): AddStockEntry => {
  if (item.kind === "counted") {
    const action = recordedActionFor(restock, item.row);
    return {
      baseCount: leftAfterPull(item.row) ?? 0,
      isOnTopOfMove: false,
      wentIn: action?.kind === "added" ? action.added : "",
    };
  }
  const { count, moved } = item;
  // Fewer than moved means the total was typed before the link or the source
  // count changed since, so "on top" would be negative: edit the total instead.
  if (moved === null || count === null || count < moved) {
    return { baseCount: 0, isOnTopOfMove: false, wentIn: item.arrival.added };
  }
  return { baseCount: moved, isOnTopOfMove: true, wentIn: String(count - moved) };
};

/** The arrival's Added once `wentIn` is typed into Add stock. */
export const arrivalAddedFor = (entry: AddStockEntry, wentIn: string): string => {
  const wentInCount = parseCount(wentIn);
  if (!entry.isOnTopOfMove || wentInCount === null) {
    return wentIn;
  }
  return String(entry.baseCount + wentInCount);
};

/** Typing a quantity equal to everything counted most likely means the product
 *  is leaving, so the editor asks whether to take it out. */
export const isTakeOutAsked = ({
  item,
  restock,
  quantity,
}: {
  item: Extract<SlotItem, { kind: "counted" }>;
  restock: Restock;
  quantity: number;
}): boolean => {
  const action = recordedActionFor(restock, item.row);
  if (action?.kind === "added" && (parseCount(action.added) ?? 0) > 0) {
    return false;
  }
  return quantity === parseCount(item.row.left);
};
