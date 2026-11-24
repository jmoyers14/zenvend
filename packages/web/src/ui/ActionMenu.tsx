import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Button } from "./Button.tsx";
import { insetFocusRing } from "./focus.ts";

export interface ActionMenuItem<Value extends string = string> {
  value: Value;
  label: string;
}

interface ActionMenuProps<Value extends string> {
  /** Accessible name for the trigger, e.g. "Actions for Coke". */
  label: string;
  items: ActionMenuItem<Value>[];
  isDisabled?: boolean;
  disabledText?: string;
  onSelect: (value: Value) => void;
}

export const ActionMenu = <Value extends string>({
  label,
  items,
  isDisabled = false,
  disabledText = "Editing",
  onSelect,
}: ActionMenuProps<Value>) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    itemRefs.current[0]?.focus();
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const closeAndRestoreFocus = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Closed, the keys belong to the page (Escape cancels a pick there).
    if (!isOpen || items.length === 0) {
      return;
    }
    if (event.key === "Escape") {
      event.stopPropagation();
      closeAndRestoreFocus();
      return;
    }
    if (event.key === "Tab") {
      setIsOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    const currentIndex = itemRefs.current.findIndex((item) => item === document.activeElement);
    const nextIndex = (currentIndex + step + items.length) % items.length;
    itemRefs.current[nextIndex]?.focus();
  };

  const handleSelect = (value: Value) => {
    closeAndRestoreFocus();
    onSelect(value);
  };

  if (isDisabled) {
    return <span className="text-label text-on-disabled">{disabledText}</span>;
  }

  return (
    <div ref={containerRef} className="relative inline-block" onKeyDown={handleMenuKeyDown}>
      <Button
        ref={triggerRef}
        variant="secondary"
        size="sm"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((wasOpen) => !wasOpen)}
      >
        Actions ▾
      </Button>
      {isOpen ? (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 z-10 mt-1 min-w-48 divide-y divide-divider overflow-hidden rounded-control border border-line bg-card"
        >
          {items.map((item, index) => (
            <button
              key={item.value}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              onClick={() => handleSelect(item.value)}
              className={`flex w-full items-center px-4 py-3 text-left text-body text-ink hover:bg-action-soft ${insetFocusRing}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
