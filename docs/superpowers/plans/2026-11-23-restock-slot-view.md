# Restock Slot View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Restock step's slot editor so it shows one row per product currently in the slot, each with a live count and its own Actions menu, and a single action panel underneath.

**Architecture:** The `Restock` state in `restock.ts` is unchanged except for two rule changes: a partial pull counts as an answer, and a moved-in arrival has its count filled in. A new pure module, `slotContents.ts`, works out the rows, labels, departures and per-row actions from that state. React components render it. The panels act on one product at a time.

**Tech Stack:** React 18, TypeScript, Tailwind v4, `bun test` (pure `.ts` tests only; the web package has no component tests), Biome.

**Spec:** `docs/superpowers/specs/2026-11-23-restock-slot-view-design.md`

## Global Constraints

- Web only. No changes to `packages/api`, `packages/domain`, or iOS.
- The saved visit must not change, apart from the two rule changes: a partial pull alone saves as Added 0, and a moved-in arrival's Added is pre-filled.
- Menu actions keep today's names: **Add stock · Move → · Swap ⇄ · Pull · Nothing changed**, plus **Edit pull**, **Undo move** and **Remove**, depending on the row.
- The row button is **Actions ▾**. The row being edited shows a greyed **Editing**.
- Copy is fixed by the spec's "Row labels" table. Use the exact strings, including the `✓`, `↳`, `⇄` and `·` characters.
- Follow the repo's naming rules in `CLAUDE.md`: noun phrases for pure functions, `restockWith*` for functions that return a new Restock, and options objects instead of positional booleans.
- Commits use a scope from: api, web, domain, platform, worker, e2e, ios. Subjects are lowercase.
- Verify from the repo root with `bun run --cwd packages/web test`, `bun run --cwd packages/web typecheck` and `bun run lint`.

## Review Focus

1. **Every product in a slot moved out.** The slot has no rows, the departures note shows the products that left with Undo, and the slot still counts as answered. Pinned in Task 3: `slotContentsFor` "keeps departures when every product left".
2. **Pulling every counted unit on a row that already has Add stock.** This must not ask to take the product out, and it must not drop the +8. Pinned in Task 3: `isTakeOutAsked` "is false when the row already has Add stock".
3. **A swap with a mixed slot.** Only the chosen partner product appears at the back of the other slot, labeled "⇄ From A1". The other product in the mixed slot stays where it was. Pinned in Task 3: `slotContentsFor` "puts only the swapped partner at the back of each slot".
4. **A row counted at 0.** It has no Pull in its menu, and its label reads "Counted 0". Pinned in Task 3: `rowActionsFor` "omits Pull for a row counted at 0".
5. **A new product added with a blank count.** It stays unanswered with the label "New", so the slot isn't marked done early. Pinned in Task 3: `slotContentLabelFor` "labels a new arrival without a count as New".

---

### Task 1: A partial pull counts as an answer

**Files:**
- Modify: `packages/web/src/screens/visits/visitRows.ts` (add `hasPartialPull`)
- Modify: `packages/web/src/screens/visits/restock.ts` (add `answeredActionFor`)
- Modify: `packages/web/src/screens/visits/restockSlots.ts:110-127` (`isSlotAnswered`)
- Modify: `packages/web/src/screens/visits/visitActivity.ts:91-95` (`rowActivity`)
- Modify: `packages/web/src/screens/visits/visitSubmission.ts:210-214` (unanswered check)
- Test: `restockSlots.test.ts`, `visitActivity.test.ts`, `visitSubmission.test.ts` (same folder)

**Interfaces:**
- Produces: `hasPartialPull(row: VisitRow): boolean`. True when `parseCount(row.removed)` is ≥ 1 and `row.removedReason !== null`.
- Produces: `answeredActionFor(restock: Restock, row: VisitRow): ProductAction | undefined`. This is the row's action. When the row has no action but has a partial pull, it returns `{ kind: "added", added: "0" }`. Every check of whether a row is answered goes through this function.

- [ ] **Step 1: Write the failing tests**

In `restockSlots.test.ts`, `describe("isSlotAnswered")`:
```ts
it("counts a partial pull with no other answer as answered", () => {
  const rows = buildRows();
  const coke = { ...rowFor(rows, "A1", "coke"), removed: "2", removedReason: "expired" as const };
  const withPull = rows.map((row) => (row === rowFor(rows, "A1", "coke") ? coke : row));
  const restock = buildRestock({ shelves: SHELVES, rows: withPull });
  expect(isSlotAnswered({ rows: withPull, restock, slotCode: "A1" })).toBe(true);
});
```
In `visitSubmission.test.ts`: a counted row with `left: "5"`, `removed: "2"`, `removedReason: "expired"` and no action produces `line({ slotCode, productId, remaining: 5, added: 0, removed: 2, removedReason: "expired", … })`, and there's no `unanswered` problem.

In `visitActivity.test.ts`: the same row gives an activity with `outcome: "stayed"`, `added: 0` and `now: 3`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun run --cwd packages/web test screens/visits`
Expected: the three new tests FAIL. `isSlotAnswered` is false, the submission reports `unanswered`, and the outcome is `"unanswered"`.

- [ ] **Step 3: Implement**

Add `hasPartialPull` and `answeredActionFor`. Replace `restock.actions[slotProductKey(row)]` with `answeredActionFor(restock, row)` in `isSlotAnswered`, in `rowActivity`, and in the main loop of `buildVisitSubmission`. Leave `restockWithRestUnchanged` as it is: Added 0 on a pulled row means the same thing.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun run --cwd packages/web test screens/visits`
Expected: PASS, including every existing test.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/screens/visits
git commit -m "feat(web): count a partial pull as a restock answer"
```

---

### Task 2: Moved-in products start with the units that moved

**Files:**
- Modify: `packages/web/src/screens/visits/restock.ts:108-131` (`withMove`)
- Test: `restock.test.ts`, `restockSlots.test.ts`, `visitSubmission.test.ts` (same folder)

**Interfaces:**
- Consumes: `leftAfterPull(row)` from `visitRows.ts`.
- Produces: an arrival created by a move or swap whose `added` is `String(leftAfterPull(row))`, or `""` when that's null. `restockWithSourceLinked` keeps the arrival's existing `added`, so its behavior doesn't change.

- [ ] **Step 1: Update the expected values and add a test**

In `restock.test.ts`, the move and swap expectations at lines 90, 249, 367, 392 and 566 currently expect `added: ""`. Change them to the source's left count. In those fixtures, coke is counted at the value the test sets. Read each fixture and use its `left`. Add:
```ts
it("a move pre-fills the arrival with what was left after the pull", () => {
  // coke counted 5, pulled 2 expired → arrival added "3"
});
```
In `visitSubmission.test.ts`, add a test where a move with no further input submits an arrival line with `added` equal to the source's remaining count and no `added-blank` problem.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun run --cwd packages/web test screens/visits`
Expected: FAIL on the updated expectations, which receive `""`.

- [ ] **Step 3: Implement**

In `withMove`, set `added: String(leftAfterPull(row) ?? "")`. Note that `String(null ?? "")` is `""`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun run --cwd packages/web test screens/visits`
Expected: PASS. Also update the `restockSlots.test.ts` lines 84 and 195 if they assert on a moved arrival's `added`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/screens/visits
git commit -m "feat(web): pre-fill a moved product's units in its new slot"
```

---

### Task 3: Work out a slot's contents, labels and per-row actions

**Files:**
- Create: `packages/web/src/screens/visits/slotContents.ts`
- Test: `packages/web/src/screens/visits/slotContents.test.ts`. Copy the `SHELVES`, `PLANOGRAM_SLOTS`, `PRODUCTS`, `buildRows` and `rowFor` fixtures from `restockSlots.test.ts`. That gives A1 with coke and the mixed slot A2 with doritos and lays. Add a B1 slot with one product when you need a destination.

**Interfaces:**
- Consumes: `RestockSlot` (from `restockSlots.ts`), `answeredActionFor`, `hasPartialPull` (from Task 1), `arrivalsIn`, `Arrival`, `ProductAction` (from `restock.ts`), `REMOVAL_LABELS` (from `visitActivity.ts`), `leftAfterPull`, `parseCount`, `isCounted`, `rowsInSlot` (from `visitRows.ts`).
- Produces:

```ts
export type SlotItem =
  | {
      kind: "counted";
      key: string;              // slotProductKey(row)
      productId: string;
      row: VisitRow;
      count: number | null;     // leftAfterPull + Added; leftAfterPull while unanswered
      isAnswered: boolean;
    }
  | {
      kind: "arrival";
      key: string;              // slotProductKey(arrival)
      productId: string;
      arrival: Arrival;
      count: number | null;     // parseCount(arrival.added)
      movedUnits: number | null;// source row's leftAfterPull; null for new stock
      isSwap: boolean;          // the source row's action is a swap
      isAnswered: boolean;      // arrival.added parses
    };

export interface Departure {
  key: string;
  row: VisitRow;
  action: Exclude<ProductAction, { kind: "added" }>;
}

export interface SlotContents {
  items: SlotItem[];            // counted rows that stay, front to back, then arrivals
  departures: Departure[];      // counted rows that moved, swapped or were taken out
}

export type RowAction =
  | "add-stock" | "move" | "swap" | "pull" | "edit-pull"
  | "nothing-changed" | "undo-move" | "remove";

export const slotContentsFor: (slot: RestockSlot) => SlotContents;
export const slotContentLabelFor: (item: SlotItem) => string;
export const departureLabelFor: (departure: Departure, options: { nameOf: (productId: string) => string }) => string;
export const rowActionsFor: (item: SlotItem) => RowAction[];
export const isTakeOutAsked: (options: { item: Extract<SlotItem, { kind: "counted" }>; restock: Restock; quantity: number }) => boolean;
```

Uncounted rows are excluded from `items`, because the editor shows "Count this slot first" instead.

- [ ] **Step 1: Write the failing tests**

`describe("slotContentsFor")`:
- "lists staying products front to back, then arrivals": A2 with doritos (Added "3") and lays (no answer) gives items `[doritos count 7, lays count 4]` with `isAnswered` `[true, false]`.
- "drops a moved product and lists it as a departure": move coke A1→B1. A1 has `items: []` and one departure with `action.kind "moved"`. B1's last item is an arrival of coke with `movedUnits: 4`, `count: 4`, `isSwap: false`, `isAnswered: true`.
- "keeps departures when every product left": move both A2 products out. A2 has `items: []` and `departures.length === 2`, and `isSlotAnswered` is true.
- "puts only the swapped partner at the back of each slot": swap A1 coke with A2 lays (`restockWithSwap`). A2's item product ids are `["doritos", "coke"]`, with coke an arrival with `isSwap: true`. A1's are `["lays"]`.
- "counts a partial pull": coke left "5", removed "2", no action gives `count: 3, isAnswered: true`.

`describe("slotContentLabelFor")`, with exact strings from the spec:
- unanswered coke counted 4 → `"Counted 4"`
- Added "0" → `"✓ Nothing changed"`
- Added "8" → `"✓ +8"`
- pull 2 expired, no action → `"✓ Pulled 2 expired"`
- pull 2 expired + Added "8" → `"✓ Pulled 2 expired · +8"`
- moved arrival from A1, added = movedUnits → `"↳ From A1"`
- moved arrival with added movedUnits + 5 → `"↳ From A1 · +5 new"`
- swapped arrival → `"⇄ From A1"`
- new arrival with added "6" → `"New · +6"`
- "labels a new arrival without a count as New" → `"New"`

`describe("departureLabelFor")`: a move gives `"Coke → B1"`, a swap gives `"Coke ⇄ B1"`, and a take-out gives `"Coke · taken out, expired"`. Use `nameOf = (id) => id === "coke" ? "Coke" : id`.

`describe("rowActionsFor")`:
- counted, no pull → `["add-stock", "move", "swap", "pull", "nothing-changed"]`
- "omits Pull for a row counted at 0" → `["add-stock", "move", "swap", "nothing-changed"]`
- counted with a partial pull → `["add-stock", "edit-pull", "nothing-changed"]`
- moved or swapped arrival → `["add-stock", "undo-move"]`
- new arrival → `["add-stock", "remove"]`

`describe("isTakeOutAsked")`:
- coke counted 4, no action, quantity 4 → `true`
- quantity 3 → `false`
- "is false when the row already has Add stock": Added "8", quantity 4 → `false`

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun run --cwd packages/web test slotContents`
Expected: FAIL with "Cannot find module './slotContents.ts'".

- [ ] **Step 3: Implement `slotContents.ts`**

- A label's pull text is `Pulled ${n} ${REMOVAL_LABELS[reason]}`. "New units" is `count − movedUnits`, and only shows when it's > 0.
- `isTakeOutAsked` is `quantity === parseCount(row.left)`, and only when the row's own action isn't `added` with a value above 0.
- Module doc: pure; this is what the Restock slot view shows.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun run --cwd packages/web test slotContents`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/screens/visits/slotContents.ts packages/web/src/screens/visits/slotContents.test.ts
git commit -m "feat(web): derive a restock slot's live contents and row actions"
```

---

### Task 4: An `ActionMenu` primitive

**Files:**
- Create: `packages/web/src/ui/ActionMenu.tsx`
- Modify: `packages/web/src/ui.tsx` (export it)

**Interfaces:**
- Produces:
```ts
export interface ActionMenuItem { value: string; label: string }
export function ActionMenu(props: {
  label: string;                 // accessible name, e.g. "Actions for Coke"
  items: ActionMenuItem[];
  isDisabled?: boolean;          // renders the greyed "Editing" state
  disabledText?: string;         // "Editing"
  onSelect: (value: string) => void;
}): JSX.Element;
```
The trigger is a secondary `Button` showing "Actions ▾". The popover is `role="menu"`, with `role="menuitem"` buttons. It closes on select, on Escape, and on a click outside. Arrow keys move focus between items. There's no new dependency. Style it with the existing tokens (`bg-card`, `border-line`, `rounded-control`), the same way as `LoadProductPanel`'s list.

- [ ] **Step 1: Implement the component.** The web package has no component test harness, so this task is verified by type checking and by hand in Task 6.
- [ ] **Step 2: Run** `bun run --cwd packages/web typecheck`. Expected: no errors.
- [ ] **Step 3: Commit**

```bash
git add packages/web/src/ui/ActionMenu.tsx packages/web/src/ui.tsx
git commit -m "feat(web): add an action menu component"
```

---

### Task 5: Single-product panels

**Files:**
- Modify: `packages/web/src/screens/visits/RestockPanels.tsx`. It replaces `AddStockPanel`, `PullPanel` and `LoadProductPanel`. `BestByCell` and the "Came from X?" logic in `AddEntryNote` carry over.

**Interfaces:**
- Consumes: `SlotItem` and `isTakeOutAsked` (Task 3); `restockWithAction`, `restockWithArrivalChange`, `restockWithNewStock`, `restockWithSourceLinked`, `suggestedSourcesFor` (restock.ts); `rowWithRemoved`, `rowWithRemovedReason` (visitRows.ts); `EditorInset` (SlotEditor.tsx).
- Produces:
```ts
export function AddStockPanel(props: {
  item: SlotItem; restock: Restock; rows: readonly VisitRow[];
  nameOf: (productId: string) => string;
  onRestockChange: (next: Restock) => void; onDone: () => void;
}): JSX.Element;

export function PullPanel(props: {
  item: Extract<SlotItem, { kind: "counted" }>; restock: Restock;
  nameOf: (productId: string) => string;
  onRowChange: (next: VisitRow) => void;
  onRestockChange: (next: Restock) => void; onDone: () => void;
}): JSX.Element;

export function AddProductPanel(props: {
  slotCode: string; products: ProductOption[]; rows: readonly VisitRow[]; restock: Restock;
  tracksExpirationOf: (productId: string) => boolean;
  onRestockChange: (next: Restock) => void; onDone: () => void;
}): JSX.Element;
```

Behavior. The titles and copy come from the spec:
- **AddStockPanel**, titled `Add stock · {name}`:
  - **Counted row:** one input, "How many went in?", pre-filled from an existing `added` action. Done writes `restockWithAction(…, { kind: "added", added })`.
  - **Moved-in arrival:** the input is "New units on top", starting at `count − movedUnits`. Done writes `added = movedUnits + new`.
  - **New arrival:** the input is "How many went in?".
  - Show the best-by input when `arrival.tracksExpiration`.
  - Show a live "Now N" next to the input.
- **PullPanel**, titled `Pull · {name}`, or `Edit pull · {name}` when `hasPartialPull(row)`:
  - Pre-fill from the row's existing `removed` and `removedReason`. The reason chips stay as they are.
  - Quantity is between 1 and `parseCount(row.left)`. Use an "All N" chip, not today's Switch.
  - When `isTakeOutAsked` is true, show the prompt "That's every unit. Take {name} out of this slot too?" with the chips **Yes, take it out** and **No, I'll refill it**. Done can't be pressed until one is picked.
  - Yes clears the row's pull and writes `{ kind: "pulled", reason }`, which is today's take-out branch. No writes the partial pull.
  - Edit pull also offers **Undo pull**, which clears `removed` and `removedReason`.
- **AddProductPanel**, titled `Add a product to {slotCode}`:
  - Step one is the product search from `LoadProductPanel`.
  - Picking a product calls `restockWithNewStock`. The panel then shows "How many went in?", best-by when tracked, and the "Came from X?" buttons from `AddEntryNote`.
  - Done writes `restockWithArrivalChange`.
  - Cancel after picking calls `restockWithoutNewStock`, so no blank arrival is left behind.

- [ ] **Step 1: Implement the three panels.**
- [ ] **Step 2: Run** `bun run --cwd packages/web typecheck`. Expected: errors only in `RestockSlotEditor.tsx`, from the old prop shapes. Task 6 fixes them.
- [ ] **Step 3: Commit together with Task 6.** The editor doesn't compile in between, so the two tasks share one commit.

---

### Task 6: The slot view in `RestockSlotEditor`

**Files:**
- Create: `packages/web/src/screens/visits/SlotContentsList.tsx`
- Modify: `packages/web/src/screens/visits/RestockSlotEditor.tsx` (rewrite the body; keep the price editor, problem Alert, uncounted notice, pick inset and footer)
- Modify: `packages/web/src/screens/visits/SlotEditor.tsx` (`SlotEditorHeader`)
- Modify: `packages/web/src/screens/visits/VisitEntryScreen.tsx:251,314,564-600` (`RestockPanel` type, props)

**Interfaces:**
- Consumes: Tasks 3, 4 and 5.
- Produces:
```ts
export type RestockPanel =
  | { kind: "add-stock"; key: string }
  | { kind: "pull"; key: string }
  | { kind: "add-product" };

export function SlotContentsList(props: {
  contents: SlotContents;
  editingKey: string | null;
  nameOf: (productId: string) => string;
  onAction: (item: SlotItem, action: RowAction) => void;
  onUndoDeparture: (departure: Departure) => void;
  onAddProduct: () => void;
  onRestUnchanged: (() => void) | null;   // null hides "Nothing else changed"
}): JSX.Element;
```
`SlotEditorHeader` gets an optional `productCount?: number`. When it's given, the header shows no `<h2>` of names, and the note reads `Row {shelf} · {n} products, front to back`, or `Row {shelf}` for a single product, or `No product loaded` for none. The Count editor's call is unchanged.

Behavior:
- **Rows** use a fixed-column grid: position (`Front`, `2nd`, `3rd`, …, `Back`, left blank when there's one item), name + label, count, and `ActionMenu`, roughly `grid-cols-[56px_1fr_56px_132px]`.
  - Answered rows use `bg-success-soft`.
  - The row whose `key === editingKey`, or whose row is the current pick, is highlighted, and its menu shows Editing.
  - Count is `item.count ?? "—"`.
- **Under a counted row with a partial pull**, the hint "Undo the pull to move this product" shows in muted text.
- **Departures:** `Moved out: {departureLabelFor(...)} · Undo`, one line each, under the rows.
- **Dashed row:** "+ Add a product to this slot" opens `{ kind: "add-product" }`.
- **"Nothing else changed"** (text button) shows while any item is unanswered. It calls `restockWithRestUnchanged(restock, rowsInSlot(rows, slotCode))`.
- **Menu dispatch** in `RestockSlotEditor`:

| Action | Does |
|---|---|
| add-stock | `onPanelChange({ kind: "add-stock", key })` |
| move | `onStartPick(row, { isSwap: false })` |
| swap | `onStartPick(row, { isSwap: true })` |
| pull, edit-pull | `onPanelChange({ kind: "pull", key })` |
| nothing-changed | `restockWithAction(restock, row, { kind: "added", added: "0" })` |
| undo-move | `restockWithAction(restock, sourceRow, null)`, where `sourceRow` is the row at `arrival.fromSlotCode` with the same product |
| remove | `restockWithoutNewStock(restock, arrival)` |

  Departure Undo is `restockWithAction(restock, departure.row, null)`.
- **Removed:** the "What happened in this slot?" button group, the answers summary bar with Undo, "+ Load a different product" with its hint, the `choose-move`/`choose-swap` product chooser (rows choose the product now), and the `slotViewFor` "arrivals" branch.
- **Kept:** the price editor in the header, the problem Alert, the "Count this slot before restocking it" notice, the empty-slot case (zero items and zero departures shows the dashed add row), the map-pick inset for Move/Swap including the mixed-slot partner chooser, and the footer with its primary-button logic. "add" as the primary becomes no primary button while unanswered.

- [ ] **Step 1: Implement `SlotContentsList`, the header prop and the `RestockSlotEditor` rewrite. Update `VisitEntryScreen`.**
- [ ] **Step 2: Run** `bun run --cwd packages/web typecheck && bun run --cwd packages/web test`. Expected: no errors, and every test passes.
- [ ] **Step 3: Check by hand in the browser.** Use the `run` skill to start `bun run dev`, then open a machine with a mixed slot and log a visit:
  - The A2-style mixed slot shows one row per product with aligned counts.
  - Add stock 8 on one product makes the row green with "✓ +8" and the count updates.
  - Moving a product to another slot removes it here and shows the "Moved out" note. In the destination it shows "↳ From …" at the back with its count.
  - Pulling every counted unit asks the take-out question, and Yes removes the row.
  - A row with a partial pull hides Move and Swap.
  - "Nothing else changed" marks the remaining rows, the map tile turns answered, and Review shows no unanswered warning.
  - Take a screenshot of the mixed slot for the PR.
- [ ] **Step 4: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): show the restock slot as one row per product"
```

---

### Task 7: Remove dead code and run the full checks

**Files:**
- Modify: `packages/web/src/screens/visits/visitActivity.ts`. Delete `describeSlotAnswers` if nothing imports it any more, along with its tests.
- Modify: `packages/web/src/screens/visits/restockSlots.ts`. Delete `stayingRowsIn` and `unloadableProductIdsFor` only if they have no callers left. `AddProductPanel` probably still uses `unloadableProductIdsFor` to narrow products, so check first.

- [ ] **Step 1: Find callers:** `grep -rn -e describeSlotAnswers -e stayingRowsIn -e unloadableProductIdsFor -e nowLevelAfterRestock packages/web/src`. Delete each one that only has its own tests left.
- [ ] **Step 2: Run** `bun run --cwd packages/web test && bun run typecheck && bun run lint`. Expected: all pass.
- [ ] **Step 3: Commit**

```bash
git add packages/web/src
git commit -m "refactor(web): drop restock helpers the slot view replaced"
```
