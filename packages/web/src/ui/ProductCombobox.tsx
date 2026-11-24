import { useMemo, useState } from "react";
import {
  activeProductsByName,
  buildComboboxEntries,
  type ComboboxEntry,
  type ProductOption,
} from "./productCombobox.ts";
import { TextInput } from "./TextInput.tsx";

const NEW_PRODUCT_LABEL = "➕ New product";

interface ProductComboboxProps {
  products: ProductOption[];
  productId: string;
  onPick: (product: ProductOption) => void;
  /** When given, the list ends with a "New product" entry. */
  newProduct?: { isSelected: boolean; onPick: () => void };
  "aria-label"?: string;
}

/**
 * Type-to-search product picker. An empty box lists every active product A–Z,
 * so it still works as a plain dropdown. Put it inside a `<Field>` for its
 * label, or pass `aria-label`.
 */
export function ProductCombobox({
  products,
  productId,
  onPick,
  newProduct,
  "aria-label": ariaLabel,
}: ProductComboboxProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const activeProducts = useMemo(() => activeProductsByName(products), [products]);
  const searchTerm = query.trim();
  const entries = buildComboboxEntries(activeProducts, {
    searchTerm,
    offersNewProduct: newProduct !== undefined,
  });
  const hasProductMatch = entries.some((entry) => entry.kind === "product");
  const isNewProductSelected = newProduct?.isSelected ?? false;
  const selectedLabel = isNewProductSelected
    ? NEW_PRODUCT_LABEL
    : (products.find((p) => p.id === productId)?.name ?? "");

  const pick = (entry: ComboboxEntry) => {
    if (entry.kind === "product") {
      onPick(entry.product);
    } else {
      newProduct?.onPick();
    }
    setIsOpen(false);
    setQuery("");
  };

  return (
    <div className="relative">
      <TextInput
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={selectedLabel || "Search products…"}
        value={isOpen ? query : selectedLabel}
        onFocus={() => {
          setQuery("");
          setHighlightedIndex(0);
          setIsOpen(true);
        }}
        onBlur={() => setIsOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlightedIndex(0);
          setIsOpen(true);
        }}
        onKeyDown={(e) => {
          switch (e.key) {
            case "ArrowDown":
              e.preventDefault();
              setIsOpen(true);
              setHighlightedIndex((i) => Math.min(i + 1, entries.length - 1));
              break;
            case "ArrowUp":
              e.preventDefault();
              setHighlightedIndex((i) => Math.max(i - 1, 0));
              break;
            case "Enter": {
              const entry = entries[highlightedIndex];
              if (isOpen && entry) {
                e.preventDefault();
                pick(entry);
              }
              break;
            }
            case "Escape":
              setIsOpen(false);
              break;
          }
        }}
      />

      {isOpen ? (
        <ul
          role="listbox"
          className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-control border border-line bg-card shadow-card"
        >
          {hasProductMatch ? null : (
            <li className="px-3.5 py-2.5 text-body text-muted-strong">
              No product matches “{searchTerm}”.
            </li>
          )}
          {entries.map((entry, index) => {
            const isNewProduct = entry.kind === "newProduct";
            const isSelected = isNewProduct
              ? isNewProductSelected
              : entry.product.id === productId;
            const isHighlighted = index === highlightedIndex;
            return (
              <li
                key={isNewProduct ? "new-product" : entry.product.id}
                role="option"
                aria-selected={isHighlighted}
                // Mouse-down would blur the input and close this first.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => pick(entry)}
                // Pinned to the bottom so it is reachable without scrolling
                // past every product.
                className={`cursor-pointer truncate px-3.5 py-2.5 text-body text-ink ${
                  isNewProduct ? "sticky bottom-0 border-t border-line" : ""
                } ${isHighlighted ? "bg-action-soft" : isNewProduct ? "bg-card" : ""} ${
                  isSelected ? "font-bold" : ""
                }`}
              >
                {isNewProduct ? `${NEW_PRODUCT_LABEL}…` : entry.product.name}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
