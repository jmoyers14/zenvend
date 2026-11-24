import { useMemo, useState } from "react";
import {
  Button,
  ChipGroup,
  Field,
  insetFocusRing,
  NumberInput,
  type ProductOption,
  TextInput,
} from "../../ui.tsx";
import { onEnterKey } from "../../utils/keyboard.ts";
import { rankByName } from "../../utils/textMatch.ts";
import {
  type Arrival,
  arrivalsIn,
  type LinkedSource,
  type PullReason,
  type Restock,
  recordedActionFor,
  restockWithAction,
  restockWithArrivalChange,
  restockWithNewStock,
  restockWithoutAddedProduct,
  restockWithSourceLinked,
  suggestedSourcesFor,
} from "./restock.ts";
import { EditorInset } from "./SlotEditor.tsx";
import {
  addStockEntryFor,
  arrivalAddedFor,
  isTakeOutAsked,
  type SlotItem,
} from "./slotContents.ts";
import { REMOVAL_LABELS } from "./visitActivity.ts";
import {
  hasPartialPull,
  parseCount,
  rowWithRemoved,
  rowWithRemovedReason,
  type VisitRow,
} from "./visitRows.ts";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const PULL_REASONS: { value: PullReason; label: string }[] = (
  ["expired", "damaged", "recalled", "destocked"] as const
).map((value) => ({ value, label: capitalize(REMOVAL_LABELS[value]) }));

type CountedItem = Extract<SlotItem, { kind: "counted" }>;

/** How many went in for one product. A moved-in product edits the new units
 *  on top, and its arrival keeps the total. */
export function AddStockPanel({
  item,
  restock,
  rows,
  nameOf,
  onRestockChange,
  onDone,
}: {
  item: SlotItem;
  restock: Restock;
  rows: readonly VisitRow[];
  nameOf: (productId: string) => string;
  onRestockChange: (next: Restock) => void;
  onDone: () => void;
}) {
  // Fixed at open, so the label and the typed number keep one meaning.
  const [entry] = useState(() => addStockEntryFor(item, restock));
  const [wentIn, setWentIn] = useState(entry.wentIn);
  const [bestBy, setBestBy] = useState(item.kind === "arrival" ? item.arrival.bestBy : "");

  const name = nameOf(item.productId);
  const isMovedIn = item.kind === "arrival" && item.moved !== null;
  const wentInCount = parseCount(wentIn);
  const nowCount = wentInCount === null ? null : entry.baseCount + wentInCount;
  const tracksExpiration = item.kind === "arrival" && item.arrival.tracksExpiration;

  const handleDone = () => {
    if (wentInCount === null) {
      return;
    }
    if (item.kind === "counted") {
      onRestockChange(restockWithAction(restock, item.row, { kind: "added", added: wentIn }));
    } else {
      const added = arrivalAddedFor(entry, wentIn);
      onRestockChange(restockWithArrivalChange(restock, item.arrival, { added, bestBy }));
    }
    onDone();
  };

  // Linking turns the arrival into a move, so what was typed goes with it and
  // the panel closes rather than switch to "New units on top" mid-edit.
  const handleLinkSource = (source: VisitRow) => {
    if (item.kind !== "arrival") {
      return;
    }
    const arrival = { ...item.arrival, added: wentIn, bestBy };
    onRestockChange(restockWithSourceLinked(restock, { arrival, source }));
    onDone();
  };

  return (
    <EditorInset title={`Add stock · ${name}`} onCancel={onDone}>
      <WentInFields
        label={entry.isOnTopOfMove ? "New units on top" : "How many went in?"}
        name={name}
        wentIn={wentIn}
        nowCount={nowCount}
        bestBy={tracksExpiration ? bestBy : null}
        onWentInChange={setWentIn}
        onBestByChange={setBestBy}
        onSubmit={handleDone}
      />
      {item.kind === "arrival" && !isMovedIn ? (
        <SourceNote
          arrival={item.arrival}
          rows={rows}
          restock={restock}
          onLinkSource={handleLinkSource}
        />
      ) : null}
      <div>
        <Button onClick={handleDone} disabled={wentInCount === null}>
          Done
        </Button>
      </div>
    </EditorInset>
  );
}

/** The count input with a live "Now N", and best-by when the product tracks it. */
function WentInFields({
  label,
  name,
  wentIn,
  nowCount,
  bestBy,
  onWentInChange,
  onBestByChange,
  onSubmit,
}: {
  label: string;
  name: string;
  wentIn: string;
  nowCount: number | null;
  /** Null hides the date input. */
  bestBy: string | null;
  onWentInChange: (wentIn: string) => void;
  onBestByChange: (bestBy: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="w-[160px]">
        <Field label={label}>
          <NumberInput
            size="lg"
            autoFocus
            aria-label={`${label}, ${name}`}
            placeholder="0"
            value={wentIn}
            onChange={(event) => onWentInChange(event.target.value)}
            onKeyDown={onEnterKey(onSubmit)}
          />
        </Field>
      </div>
      <span className="pb-3 font-display text-xl font-bold text-ink tabular-nums">
        Now {nowCount ?? "—"}
      </span>
      {bestBy === null ? null : (
        <div className="w-[180px]">
          <Field label="Best by">
            <TextInput
              type="date"
              className="h-14"
              aria-label={`Best by, ${name}`}
              value={bestBy}
              onChange={(event) => onBestByChange(event.target.value)}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

/** Where an arrival came from, or the slots it might have come from. */
function SourceNote({
  arrival,
  rows,
  restock,
  onLinkSource,
}: {
  arrival: Arrival;
  rows: readonly VisitRow[];
  restock: Restock;
  onLinkSource: (source: VisitRow) => void;
}) {
  if (arrival.fromSlotCode !== null) {
    return <span className="text-body-sm text-muted-strong">From {arrival.fromSlotCode}</span>;
  }
  const sources = suggestedSourcesFor(restock, rows, arrival);
  if (sources.length === 0) {
    return null;
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-body-sm text-muted-strong">
      New in this slot
      {sources.map((source) => (
        <Button
          key={source.slotCode}
          variant="text"
          size="sm"
          onClick={() => onLinkSource(source)}
        >
          Came from {source.slotCode}?
        </Button>
      ))}
    </span>
  );
}

type TakeOutAnswer = "yes" | "no";

const TAKE_OUT_OPTIONS: { value: TakeOutAnswer; label: string }[] = [
  { value: "yes", label: "Yes, take it out" },
  { value: "no", label: "No, I'll refill it" },
];

/**
 * Units pulled from one counted product. Pulling every unit asks whether the
 * product leaves the slot too; otherwise it stays and the pull is its answer.
 */
export function PullPanel({
  item,
  restock,
  nameOf,
  onRowChange,
  onRestockChange,
  onDone,
}: {
  item: CountedItem;
  restock: Restock;
  nameOf: (productId: string) => string;
  onRowChange: (next: VisitRow) => void;
  onRestockChange: (next: Restock) => void;
  onDone: () => void;
}) {
  const { row } = item;
  const isEditing = hasPartialPull(row);
  const [reason, setReason] = useState<PullReason | null>(
    () => PULL_REASONS.find((option) => option.value === row.removedReason)?.value ?? null,
  );
  const [quantity, setQuantity] = useState(isEditing ? row.removed : "");
  const [takeOut, setTakeOut] = useState<TakeOutAnswer | null>(null);

  const name = nameOf(row.productId);
  const found = parseCount(row.left) ?? 0;
  const parsedQuantity = parseCount(quantity);
  const isQuantityValid =
    parsedQuantity !== null && parsedQuantity >= 1 && parsedQuantity <= found;
  const isTakeOutQuestion =
    isQuantityValid && isTakeOutAsked({ item, restock, quantity: parsedQuantity });
  const canFinish =
    reason !== null && isQuantityValid && (!isTakeOutQuestion || takeOut !== null);
  const allValue = String(found);

  const clearedRow = rowWithRemovedReason(rowWithRemoved(row, ""), null);

  const handleDone = () => {
    if (reason === null || !canFinish) {
      return;
    }
    if (isTakeOutQuestion && takeOut === "yes") {
      // Everything counted leaves with the product, so no separate pull.
      onRowChange(clearedRow);
      onRestockChange(restockWithAction(restock, row, { kind: "pulled", reason }));
    } else {
      onRowChange(rowWithRemovedReason(rowWithRemoved(row, quantity), reason));
    }
    onDone();
  };

  const handleUndoPull = () => {
    onRowChange(clearedRow);
    onDone();
  };

  return (
    <EditorInset title={`${isEditing ? "Edit pull" : "Pull"} · ${name}`} onCancel={onDone}>
      <div className="grid gap-2">
        <span className="text-label text-ink">Why?</span>
        <ChipGroup label="Why?" options={PULL_REASONS} value={reason} onChange={setReason} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-[160px]">
          <Field label="How many?">
            <NumberInput
              autoFocus
              aria-label={`How many pulled, ${name}`}
              placeholder="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              onKeyDown={onEnterKey(handleDone)}
            />
          </Field>
        </div>
        <ChipGroup
          label="Pull all"
          options={[{ value: allValue, label: `All ${found}` }]}
          value={quantity.trim() === allValue ? allValue : null}
          onChange={setQuantity}
        />
      </div>
      {isTakeOutQuestion ? (
        <div className="grid gap-2">
          <span className="text-label text-ink">
            That's every unit. Take {name} out of this slot too?
          </span>
          <ChipGroup
            label="Take it out of this slot?"
            options={TAKE_OUT_OPTIONS}
            value={takeOut}
            onChange={setTakeOut}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={handleDone} disabled={!canFinish}>
          Done
        </Button>
        {reason === null ? (
          <span className="text-body-sm text-muted-strong">Pick a reason first</span>
        ) : null}
        {isEditing ? (
          <Button variant="text" onClick={handleUndoPull}>
            Undo pull
          </Button>
        ) : null}
      </div>
    </EditorInset>
  );
}

const RESULT_LIMIT = 6;

/** Search the catalogue, load the product as new stock, then say how many went in. */
export function AddProductPanel({
  slotCode,
  products,
  rows,
  restock,
  tracksExpirationOf,
  onRestockChange,
  onDone,
}: {
  slotCode: string;
  /** Already narrowed to the products this slot can take. */
  products: ProductOption[];
  rows: readonly VisitRow[];
  restock: Restock;
  tracksExpirationOf: (productId: string) => boolean;
  onRestockChange: (next: Restock) => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ProductOption | null>(null);
  // Cancel takes back only what this panel did, so the source's earlier answer
  // is kept rather than a snapshot of the whole restock.
  const [linkedSource, setLinkedSource] = useState<LinkedSource | null>(null);
  const [wentIn, setWentIn] = useState("");
  const [bestBy, setBestBy] = useState("");
  const alphabetical = useMemo(
    () => [...products].sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );
  const results =
    query.trim() === ""
      ? alphabetical.slice(0, RESULT_LIMIT)
      : rankByName(products, query, RESULT_LIMIT);

  const arrival =
    picked === null
      ? undefined
      : arrivalsIn(restock, slotCode).find((candidate) => candidate.productId === picked.id);
  const wentInCount = parseCount(wentIn);

  const handlePick = (product: ProductOption) => {
    onRestockChange(
      restockWithNewStock(restock, {
        slotCode,
        productId: product.id,
        tracksExpiration: tracksExpirationOf(product.id),
      }),
    );
    setPicked(product);
  };

  const handleDone = () => {
    if (!arrival || wentInCount === null) {
      return;
    }
    onRestockChange(restockWithArrivalChange(restock, arrival, { added: wentIn, bestBy }));
    onDone();
  };

  const handleCancel = () => {
    if (picked) {
      const key = { slotCode, productId: picked.id };
      onRestockChange(restockWithoutAddedProduct(restock, { key, linkedSource }));
    }
    onDone();
  };

  const handleLinkSource = (source: VisitRow) => {
    if (!arrival) {
      return;
    }
    setLinkedSource({ row: source, action: recordedActionFor(restock, source) });
    onRestockChange(restockWithSourceLinked(restock, { arrival, source }));
  };

  return (
    <EditorInset title={`Add a product to ${slotCode}`} onCancel={handleCancel}>
      {picked && arrival ? (
        <>
          <span className="text-body font-bold text-ink">{picked.name}</span>
          <WentInFields
            label="How many went in?"
            name={picked.name}
            wentIn={wentIn}
            nowCount={wentInCount}
            bestBy={arrival.tracksExpiration ? bestBy : null}
            onWentInChange={setWentIn}
            onBestByChange={setBestBy}
            onSubmit={handleDone}
          />
          <SourceNote
            arrival={arrival}
            rows={rows}
            restock={restock}
            onLinkSource={handleLinkSource}
          />
          <div>
            <Button onClick={handleDone} disabled={wentInCount === null}>
              Done
            </Button>
          </div>
        </>
      ) : (
        <ProductSearch
          slotCode={slotCode}
          query={query}
          results={results}
          onQueryChange={setQuery}
          onPick={handlePick}
        />
      )}
    </EditorInset>
  );
}

function ProductSearch({
  slotCode,
  query,
  results,
  onQueryChange,
  onPick,
}: {
  slotCode: string;
  query: string;
  results: ProductOption[];
  onQueryChange: (query: string) => void;
  onPick: (product: ProductOption) => void;
}) {
  return (
    <>
      <Field label="Product">
        <TextInput
          type="search"
          autoFocus
          autoComplete="off"
          placeholder="e.g. Twix"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </Field>
      {results.length === 0 ? (
        <p className="text-body-sm text-muted-strong">No products match.</p>
      ) : (
        <ul className="divide-y divide-divider overflow-hidden rounded-control border border-line bg-card">
          {results.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => onPick(product)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-body text-ink hover:bg-action-soft ${insetFocusRing}`}
              >
                <span className="truncate">{product.name}</span>
                <span className="flex-none text-label text-link">Load into {slotCode}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
