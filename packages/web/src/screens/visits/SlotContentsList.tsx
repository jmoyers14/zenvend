import { ActionMenu, Button, focusRing } from "../../ui.tsx";
import {
  type Departure,
  departureLabelFor,
  type RowAction,
  rowActionsFor,
  type SlotContents,
  slotContentLabelFor,
  type SlotItem,
} from "./slotContents.ts";

const ROW_ACTION_LABELS: Record<RowAction, string> = {
  "add-stock": "Add stock",
  move: "Move →",
  swap: "Swap ⇄",
  pull: "Pull",
  "edit-pull": "Edit pull",
  "nothing-changed": "Nothing changed",
  "undo-move": "Undo move",
  remove: "Remove",
};

/** Front, 2nd, …, Back; blank when the slot holds one product. */
const positionLabelFor = (index: number, itemCount: number): string => {
  if (itemCount < 2) {
    return "";
  }
  if (index === 0) {
    return "Front";
  }
  if (index === itemCount - 1) {
    return "Back";
  }
  if (index === 1) {
    return "2nd";
  }
  return index === 2 ? "3rd" : `${index + 1}th`;
};

/** The slot as it stands once Restock is done: one row per product, front to
 *  back, what left, and a way to add another product. */
export function SlotContentsList({
  contents,
  editingKey,
  nameOf,
  onAction,
  onUndoDeparture,
  onAddProduct,
  onRestUnchanged,
}: {
  contents: SlotContents;
  editingKey: string | null;
  nameOf: (productId: string) => string;
  onAction: (item: SlotItem, action: RowAction) => void;
  onUndoDeparture: (departure: Departure) => void;
  onAddProduct: () => void;
  /** Null hides "Nothing else changed". */
  onRestUnchanged: (() => void) | null;
}) {
  const { items, departures } = contents;
  return (
    <div className="grid gap-3">
      {items.length > 0 ? (
        <ul className="grid gap-2">
          {items.map((item, index) => (
            <SlotContentsRow
              key={item.key}
              item={item}
              position={positionLabelFor(index, items.length)}
              isEditing={item.key === editingKey}
              nameOf={nameOf}
              onAction={onAction}
            />
          ))}
        </ul>
      ) : null}
      {departures.length > 0 ? (
        <ul className="grid gap-1">
          {departures.map((departure) => {
            const label = departureLabelFor(departure, { nameOf });
            return (
              <li
                key={departure.key}
                className="flex flex-wrap items-center gap-1 text-body-sm text-muted-strong"
              >
                {departure.action.kind === "moved" ? `Moved out: ${label}` : label} ·
                <Button
                  variant="text"
                  size="sm"
                  aria-label={`Undo ${label}`}
                  onClick={() => onUndoDeparture(departure)}
                >
                  Undo
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <button
        type="button"
        onClick={onAddProduct}
        className={`rounded-panel border border-dashed border-line-strong bg-app px-4 py-3 text-left text-button text-link hover:bg-action-soft ${focusRing}`}
      >
        + Add a product to this slot
      </button>
      {onRestUnchanged ? (
        <Button variant="text" className="justify-self-start" onClick={onRestUnchanged}>
          Nothing else changed
        </Button>
      ) : null}
    </div>
  );
}

function SlotContentsRow({
  item,
  position,
  isEditing,
  nameOf,
  onAction,
}: {
  item: SlotItem;
  position: string;
  isEditing: boolean;
  nameOf: (productId: string) => string;
  onAction: (item: SlotItem, action: RowAction) => void;
}) {
  const name = nameOf(item.productId);
  const actions = rowActionsFor(item);
  const isMoveHidden = item.kind === "counted" && !actions.includes("move");
  const answeredTone = item.isAnswered ? "bg-success-soft" : "bg-app";
  const tone = isEditing ? "bg-action-soft ring-2 ring-action" : answeredTone;

  return (
    <li
      className={`grid grid-cols-[56px_1fr_56px_132px] items-center gap-3 rounded-control px-4 py-3 ${tone}`}
    >
      <span className="text-body-sm text-muted-strong">{position}</span>
      <div className="grid min-w-0 gap-0.5">
        <span className="truncate text-body font-bold text-ink">{name}</span>
        <span
          className={`text-body-sm ${item.isAnswered ? "text-success" : "text-muted-strong"}`}
        >
          {slotContentLabelFor(item)}
        </span>
        {isMoveHidden ? (
          <span className="text-body-sm text-muted-strong">
            Undo the pull to move this product
          </span>
        ) : null}
      </div>
      <span className="text-right font-display text-xl font-bold text-ink tabular-nums">
        {item.count ?? "—"}
      </span>
      <div className="justify-self-end">
        <ActionMenu
          label={`Actions for ${name}`}
          items={actions.map((action) => ({ value: action, label: ROW_ACTION_LABELS[action] }))}
          isDisabled={isEditing}
          onSelect={(action) => onAction(item, action)}
        />
      </div>
    </li>
  );
}
