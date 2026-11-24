import { slotProductKey } from "@zenvend/domain";
import { useState } from "react";
import { Alert, Button, ChipGroup, IconButton, MoneyInput } from "../../ui.tsx";
import { onEnterKey } from "../../utils/keyboard.ts";
import { formatCents, parseDollarsToCents } from "../../utils/money.ts";
import { plural } from "../../utils/text.ts";
import type { ProductOption } from "../machines/ProductCombobox.tsx";
import {
  type Restock,
  restockWithAction,
  restockWithoutNewStock,
  restockWithPrice,
  restockWithRestUnchanged,
} from "./restock.ts";
import { AddProductPanel, AddStockPanel, PullPanel } from "./RestockPanels.tsx";
import { isSlotAnswered, unloadableProductIdsFor } from "./restockSlots.ts";
import {
  EditorCard,
  EditorFooter,
  EditorInset,
  EditorNotice,
  PriceLabel,
  SlotEditorHeader,
} from "./SlotEditor.tsx";
import { SlotContentsList } from "./SlotContentsList.tsx";
import {
  type Departure,
  type RowAction,
  type SlotItem,
  slotContentsFor,
} from "./slotContents.ts";
import { isCounted, rowsInSlot, type VisitRow } from "./visitRows.ts";

/** A Move or Swap waiting for its destination on the map. */
export interface SlotPick {
  row: VisitRow;
  isSwap: boolean;
  /** A swap into a mixed slot waits here for which product came back. */
  partnerSlotCode: string | null;
  /** Why the last tap didn't take. */
  notice: string | null;
}

/** The panel open under the slot's rows, if any. */
export type RestockPanel =
  | { kind: "add-stock"; key: string }
  | { kind: "pull"; key: string }
  | { kind: "add-product" };

/**
 * The Restock step's editor for one slot: its products front to back, each
 * with its own actions. A slot is answered once every product in it has one.
 */
export function RestockSlotEditor({
  slotCode,
  shelfLabel,
  rows,
  restock,
  nameOf,
  tracksExpirationOf,
  products,
  problemMessages,
  pick,
  panel,
  isFirstSlot,
  isLastSlot,
  isEverySlotAnswered,
  unansweredSlotCount,
  onPanelChange,
  onRowChange,
  onRestockChange,
  onStartPick,
  onCancelPick,
  onSwapPartner,
  onCountSlot,
  onPrevious,
  onNext,
  onReview,
}: {
  slotCode: string;
  shelfLabel: string;
  /** Every Count row: moves, swaps and "Came from?" look at other slots. */
  rows: readonly VisitRow[];
  restock: Restock;
  nameOf: (productId: string) => string;
  tracksExpirationOf: (productId: string) => boolean;
  products: ProductOption[];
  /** What the submission says is wrong in this slot. */
  problemMessages: readonly string[];
  pick: SlotPick | null;
  panel: RestockPanel | null;
  isFirstSlot: boolean;
  isLastSlot: boolean;
  isEverySlotAnswered: boolean;
  unansweredSlotCount: number;
  onPanelChange: (panel: RestockPanel | null) => void;
  onRowChange: (next: VisitRow) => void;
  onRestockChange: (next: Restock) => void;
  onStartPick: (row: VisitRow, options: { isSwap: boolean }) => void;
  onCancelPick: () => void;
  onSwapPartner: (partner: VisitRow) => void;
  onCountSlot: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onReview: () => void;
}) {
  const [isEditingPrice, setIsEditingPrice] = useState(false);

  const slot = { rows, restock, slotCode };
  const slotRows = rowsInSlot(rows, slotCode);
  const contents = slotContentsFor(slot);
  const isUncounted = slotRows.some((row) => !isCounted(row));
  const isAnswered = isSlotAnswered(slot);
  const isPicking = pick?.row.slotCode === slotCode;
  const price = restock.prices[slotCode] ?? "";
  const priceCents = parseDollarsToCents(price);
  const unloadable = unloadableProductIdsFor(slot);
  const loadableProducts = products.filter(
    (product) => product.active && !unloadable.has(product.id),
  );
  const partnerRows =
    pick?.partnerSlotCode == null
      ? []
      : rowsInSlot(rows, pick.partnerSlotCode).filter(isCounted);

  const panelKey = panel !== null && "key" in panel ? panel.key : null;
  const panelItem = contents.items.find((item) => item.key === panelKey);
  // A keyed panel whose row has gone (its arrival undone) renders nothing, so
  // it counts as closed.
  const isAddStockOpen = panel?.kind === "add-stock" && panelItem !== undefined;
  const isPullOpen = panel?.kind === "pull" && panelItem?.kind === "counted";
  const isPanelOpen =
    isAddStockOpen || isPullOpen || panel?.kind === "add-product" || isPicking;
  const openPanelKey = isAddStockOpen || isPullOpen ? panelKey : null;
  const editingKey = isPicking && pick ? slotProductKey(pick.row) : openPanelKey;
  const hasUnansweredCounted = contents.items.some(
    (item) => item.kind === "counted" && !item.isAnswered,
  );
  const closePanel = () => onPanelChange(null);

  const handleUndoDeparture = (departure: Departure) => {
    const next = restockWithAction(restock, departure.row, null);
    const nextItems = slotContentsFor({ ...slot, restock: next }).items;
    if (panelKey !== null && !nextItems.some((item) => item.key === panelKey)) {
      closePanel();
    }
    onRestockChange(next);
  };

  const handleAction = (item: SlotItem, action: RowAction) => {
    onCancelPick();
    if (action === "add-stock") {
      onPanelChange({ kind: "add-stock", key: item.key });
      return;
    }
    if (action === "pull" || action === "edit-pull") {
      onPanelChange({ kind: "pull", key: item.key });
      return;
    }
    closePanel();
    if (item.kind === "arrival") {
      const { arrival } = item;
      if (action === "remove") {
        onRestockChange(restockWithoutNewStock(restock, arrival));
        return;
      }
      const sourceRow = rows.find(
        (row) => row.slotCode === arrival.fromSlotCode && row.productId === arrival.productId,
      );
      if (action === "undo-move" && sourceRow) {
        onRestockChange(restockWithAction(restock, sourceRow, null));
      }
      return;
    }
    if (action === "move" || action === "swap") {
      onStartPick(item.row, { isSwap: action === "swap" });
      return;
    }
    if (action === "nothing-changed") {
      onRestockChange(restockWithAction(restock, item.row, { kind: "added", added: "0" }));
    }
  };

  // One primary in view: an open panel's own button, else the slot's next step.
  const primary = (() => {
    if (isPanelOpen) {
      return null;
    }
    if (isEverySlotAnswered || (isLastSlot && isAnswered)) {
      return "review";
    }
    if (isAnswered || contents.items.length === 0) {
      return "next";
    }
    return null;
  })();

  return (
    <EditorCard label={`Restock slot ${slotCode}`}>
      <SlotEditorHeader
        slotCode={slotCode}
        shelfLabel={shelfLabel}
        productNames={isUncounted ? slotRows.map((row) => nameOf(row.productId)) : undefined}
        productCount={isUncounted ? undefined : contents.items.length}
        price={
          <>
            <PriceLabel>Price</PriceLabel>
            {isEditingPrice ? (
              <div className="mt-1 flex items-center justify-end gap-2">
                <div className="w-[120px]">
                  <MoneyInput
                    size="sm"
                    autoFocus
                    aria-label="Price in dollars"
                    className="text-right"
                    value={price}
                    onChange={(event) =>
                      onRestockChange(restockWithPrice(restock, slotCode, event.target.value))
                    }
                    onKeyDown={onEnterKey(() => setIsEditingPrice(false))}
                  />
                </div>
                <Button variant="text" onClick={() => setIsEditingPrice(false)}>
                  Done
                </Button>
              </div>
            ) : (
              <div className="mt-1 flex items-center justify-end gap-1">
                <span className="font-mono text-2xl font-medium text-ink tabular-nums">
                  {priceCents === null ? "—" : formatCents(priceCents)}
                </span>
                <IconButton label="Edit price" onClick={() => setIsEditingPrice(true)}>
                  <PencilIcon />
                </IconButton>
              </div>
            )}
          </>
        }
      />

      {problemMessages.length > 0 ? (
        <Alert tone="warning" title="Needs a look">
          <ul className="list-disc pl-5">
            {problemMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {isUncounted ? (
        <EditorNotice>
          Count this slot before restocking it.
          <Button variant="secondary" onClick={onCountSlot}>
            Count {slotCode}
          </Button>
        </EditorNotice>
      ) : (
        <SlotContentsList
          contents={contents}
          editingKey={editingKey}
          nameOf={nameOf}
          onAction={handleAction}
          onUndoDeparture={handleUndoDeparture}
          onAddProduct={() => {
            onCancelPick();
            onPanelChange({ kind: "add-product" });
          }}
          onRestUnchanged={
            hasUnansweredCounted
              ? () => onRestockChange(restockWithRestUnchanged(restock, slotRows))
              : null
          }
        />
      )}

      {isAddStockOpen && panelItem ? (
        <AddStockPanel
          key={panelItem.key}
          item={panelItem}
          restock={restock}
          rows={rows}
          nameOf={nameOf}
          onRestockChange={onRestockChange}
          onDone={closePanel}
        />
      ) : null}

      {isPullOpen && panelItem?.kind === "counted" ? (
        <PullPanel
          key={panelItem.key}
          item={panelItem}
          restock={restock}
          nameOf={nameOf}
          onRowChange={onRowChange}
          onRestockChange={onRestockChange}
          onDone={closePanel}
        />
      ) : null}

      {panel?.kind === "add-product" ? (
        <AddProductPanel
          slotCode={slotCode}
          products={loadableProducts}
          rows={rows}
          restock={restock}
          tracksExpirationOf={tracksExpirationOf}
          onRestockChange={onRestockChange}
          onDone={closePanel}
        />
      ) : null}

      {isPicking && pick ? (
        <EditorInset
          title={`${pick.isSwap ? "Swap" : "Move"} ${nameOf(pick.row.productId)} ${pick.isSwap ? "with" : "to"} another slot`}
          onCancel={onCancelPick}
        >
          {pick.partnerSlotCode ? (
            <div className="grid gap-2">
              <span className="text-label text-ink">
                Which product in {pick.partnerSlotCode} came back to {slotCode}?
              </span>
              <ChipGroup
                label={`Product from ${pick.partnerSlotCode}`}
                options={partnerRows.map((row) => ({
                  value: row.productId,
                  label: nameOf(row.productId),
                }))}
                value={null}
                onChange={(productId) => {
                  const partner = partnerRows.find((row) => row.productId === productId);
                  if (partner) {
                    onSwapPartner(partner);
                  }
                }}
              />
            </div>
          ) : (
            <p className="text-body-sm text-muted-strong">
              Pick the slot on the machine map. Dashed slots are the ones you can
              choose.
            </p>
          )}
          {pick.notice ? <p className="text-body-sm font-bold text-warning">{pick.notice}</p> : null}
        </EditorInset>
      ) : null}

      <EditorFooter
        hint={
          isEverySlotAnswered
            ? "All slots answered"
            : `${plural(unansweredSlotCount, { one: "slot", many: "slots" })} still to answer`
        }
      >
        <Button variant="secondary" onClick={onPrevious} disabled={isFirstSlot}>
          Previous
        </Button>
        {isLastSlot ? null : (
          <Button variant={primary === "next" ? "primary" : "secondary"} onClick={onNext}>
            Next slot →
          </Button>
        )}
        {isEverySlotAnswered || isLastSlot ? (
          <Button variant={primary === "review" ? "primary" : "secondary"} onClick={onReview}>
            Review visit →
          </Button>
        ) : null}
      </EditorFooter>
    </EditorCard>
  );
}

const PencilIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    <path d="M14 6l4 4" />
  </svg>
);
