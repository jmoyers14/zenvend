# Restock slot view: one row per product

Shuffleboard: "Visit form: Restock should show the slot like you're looking at the machine" (`6b022837689ba3155a880a94`). Mockups: `.superpowers/brainstorm/*/content/` (`product-tiles.html` option A, `action-detail.html` option 2, `move-flow.html`, `remaining-panels-v2.html`).

## Why

Restock should feel like standing at the machine. When you select a slot, the editor shows what is physically in it right now, and every action you log changes it the way it would in real life. If you move a product from 122 to 124, then 124 shows it and 122 doesn't.

Today the editor (`RestockSlotEditor.tsx`) asks you to pick an action and then the product. It lists products that have already left alongside what replaced them, and it shows the level before restock, so the level doesn't update as you log. Slots with more than one product are common, and this is where the view is most confusing.

## Goals

- The right-hand panel leads with the slot's current contents: one row per product, front to back, each with a live count.
- You act on a product directly: each row has its own action menu, so you pick the product first and the action second.
- Each action changes the rows immediately, both in this slot and in any other slot it touches.

## Non-goals

- **Reordering products within a slot.** No layout change can express it today, so it gets its own card (domain + API + UI).
- **Replace as a single action.** The Replace card stays open.
- **Renaming Add stock.** The rename card stays separate.
- **Several pulls with different reasons, partial moves, and other action sequences beyond today's shape.** These need the append-only action ledger (below).
- **Removing the "every slot needs an answer" safety net.** That decision is deferred and will be made on its own.
- **iOS.** This is web only.

## Anti-goals

- A product that left the slot still looks like it's in the slot.
- A count that doesn't match what you'd see if you opened the door.
- Any change to what a submitted visit saves, beyond the rule changes listed below.

## Approaches

1. **New slot view over today's restock state (chosen).** Keep `Restock` (one action per product, plus partial pulls on the Count row and arrivals). Add a pure function that derives the slot's current rows, and rebuild the editor around them. Submission, Review and the API are untouched apart from the rule changes below.
2. **Append-only ledger of actions per slot and product.** Store every Pull, Add and Move in order, and replay the list to get each slot's contents. Jeremy considers this the right long-term model: it handles multiple pull reasons, partial moves, add-then-move, and pulls on moved-in stock. It also changes the saved visit format (one `removed` and one `removedReason` per line today), the API and the P&L. **That makes it a follow-up, not this work.**
3. *Dropped:* keep today's editor and add a contents list above it. You'd still pick the action before the product.

## Design

### Header
The slot code, the shelf, and "N products, front to back" (singular when there's one). The price stays at the top right with its edit pencil, as it works today.

### Rows
One row per product currently in the slot, front to back. Each row has fixed columns so the counts and buttons line up:

| Position | Name + label | Count | Button |
|---|---|---|---|
| Front / 2nd / … / Back (just the name when the slot holds one product) | Product name; a one-line label beneath it | What's in the slot now, a single number | **Actions ▾** |

- **Count** is the current number only. There's no "counted → now" arrow.
  - A product that stays: counted − partial pull + added.
  - A product that moved in: what moved in plus any new stock.
  - An unanswered product: counted − partial pull.
- **The row's state:**
  - unanswered: neutral
  - answered: green
  - being edited: highlighted, and its button shows a greyed **Editing**
- **Products that left** (moved, swapped out, taken out) aren't rows. Under the rows, a small note lists them with Undo, e.g. "Moved out: Apple Danish → 124 · Undo".
- **Products that arrive** go at the **back**, below everything already in the slot. That covers moves, swaps and new loads, because new stock loads behind what's in the coil.
- **"+ Add a product to this slot"** is a dashed row under the list. It replaces "+ Load a different product".
- **"Nothing else changed"** is a text button under the rows, shown while any row is unanswered. It answers every unanswered row with Added 0.

### Row labels

| State | Label |
|---|---|
| Unanswered | Counted N (plus the pull, if there is one, shown as below) |
| Nothing changed | ✓ Nothing changed |
| Add stock | ✓ +8 |
| Partial pull | ✓ Pulled 2 expired |
| Partial pull + add stock | ✓ Pulled 2 expired · +8 |
| Moved in | ↳ From 122 |
| Moved in + new stock | ↳ From 122 · +5 new |
| Swapped in | ⇄ From 124 |
| Loaded new | New · +6 |

A row never carries more than two facts, because Move and Take out end the product's time in the slot.

### Actions menu
The menu is the same set as today: **Add stock · Move → · Swap ⇄ · Pull · Nothing changed**. On an answered row it opens with the current answer, so you can edit it.

- **Pull** isn't offered on a row whose count is 0.
- **Add stock** is offered on rows that moved or were swapped in.

### Action panel
Picking an action opens **one panel under the rows**, titled with the action and the product. It has Cancel and Done. Only one panel is open at a time. The rows show the effect live as you type.

- **Add stock:** how many went in.
- **Move / Swap:** "Tap the slot on the machine map". The pick-on-the-map flow is unchanged, including choosing the partner product when you swap with a slot that holds several.
- **Pull:** how many, and why. When the quantity equals everything in the slot, ask "Take it out of this slot too?" (Yes / No, I'll refill it). Yes records a take-out; No leaves the product in the slot at 0.
- **A product that already has a pull:** the panel opens as **Edit pull**, with the earlier pull filled in. The model holds one pull per product, so a second pull would silently overwrite the first.
- **Add a product:** product search (the loadable products, same as today) and how many went in.

### What each kind of row offers
*(Claude's calls, made while writing this doc.)* Only products that were counted carry a Restock action. A product that arrives is stored separately, so its menu is smaller:

| Row | Actions ▾ offers |
|---|---|
| Counted, unanswered or answered | Add stock · Move → · Swap ⇄ · Pull · Nothing changed |
| Counted, with a partial pull | Add stock · Edit pull · Nothing changed. **Move and Swap are hidden**, with the hint "Undo the pull to move this product". The saved line holds one reason, and `split-reason` would reject a pull followed by a move. |
| Moved or swapped in | Add stock (new units on top) · Undo move. Undoing clears the move on the source row. |
| Loaded new | Add stock (edit how many) · Remove. Remove drops the arrival. |

### Pull edge cases
*(Claude's calls.)*
- "Everything" means the **counted** units (`row.left`), the same cap `PullPanel` uses today.
- The "Take it out of this slot too?" question only appears when the row has no Add stock. If the row already shows "+8", pulling every counted unit stays a partial pull ("Pulled 2 expired · +8"). This is the old stock coming out before the new goes in, and the +8 is never overwritten.
- Taking out reuses the pull's reason, so `split-reason` can't trigger.

### Moved-in units and the existing inputs
*(Claude's calls.)*
- `arrival.added` stays the **total** that went in, so the saved arrival line doesn't change. On a move it's pre-filled once, from the source's `leftAfterPull`. The Add stock panel on a moved-in row edits the new units, and stores moved + new. "+5 new" on the label is `added` minus the moved units. Count comes before Restock, so the source's count is normally final. If someone goes back and edits it, the pre-fill doesn't follow, the same as today's blank arrival.
- The **best-by** input for products that track expiration stays wherever units go in: the Add stock panel and the Add a product panel. Dropping it would change saved data.
- The **"Came from X?"** link (`AddEntryNote`, `suggestedSourcesFor`) stays in the Add a product panel. It's how a product found in a new slot gets turned into a move.

### Rule changes
- **A partial pull counts as an answer** (as Added 0 on top of the pull). `isSlotAnswered`, `describeActivity` and the submission's `unanswered` check change to match.
- **A moved or swapped-in product starts at the units that left the source slot** (`leftAfterPull`) instead of blank, so it's answered as soon as the move is made. Adding more stock adds to that number.

### Unchanged
- The machine map, its tiles, and "Mark the rest unchanged".
- The step header's answered count and the footer's slots still to answer, Previous, Next slot, and Review.
- The Review step and its unanswered warning.
- The visit submission's output, except for the rule changes above.
- The "Count this slot first" notice for an uncounted slot.

## Left to the builder

- Naming and shape of the derived row function. It should extend `restockSlots.ts` and give per-product live counts for slots with several products, which `nowLevelAfterRestock` doesn't.
- Whether the existing `AddStockPanel` and `PullPanel` get trimmed to work on one product or are replaced.
- Exact styling, within the existing `ui.tsx` components and tokens.
- Test coverage. At minimum the derived rows (several products, a move out, a move in with a top-up, a partial pull, a take-out) and the two rule changes. Update the e2e selectors in `packages/e2e/tests/visits.spec.ts`.
