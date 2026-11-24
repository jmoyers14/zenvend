import type { ApiProduct } from "../apiTypes.ts";
import { rankByName } from "../utils/textMatch.ts";

/** What the combobox reads of a product, derived so a rename breaks here. */
export type ProductOption = Pick<
  ApiProduct,
  "id" | "name" | "defaultPriceCents" | "active"
>;

export type ComboboxEntry =
  | { kind: "product"; product: ProductOption }
  | { kind: "newProduct" };

// Wider than the purchase search's 8: here the list is the whole picker.
const COMBOBOX_RESULT_LIMIT = 50;

/** The products the combobox can offer, A–Z. Sorting is the costly step, so memoize this. */
export const activeProductsByName = (products: ProductOption[]): ProductOption[] =>
  products
    .filter((product) => product.active)
    .sort((a, b) => a.name.localeCompare(b.name));

/**
 * The listbox rows for a search over `activeProductsByName`. An empty search
 * lists them all. "New product" comes last so Enter still takes the best match.
 */
export const buildComboboxEntries = (
  activeProducts: ProductOption[],
  { searchTerm, offersNewProduct }: { searchTerm: string; offersNewProduct: boolean },
): ComboboxEntry[] => {
  const matches = searchTerm
    ? rankByName(activeProducts, searchTerm, COMBOBOX_RESULT_LIMIT)
    : activeProducts;
  const entries: ComboboxEntry[] = matches.map((product) => ({
    kind: "product",
    product,
  }));
  return offersNewProduct ? [...entries, { kind: "newProduct" }] : entries;
};
