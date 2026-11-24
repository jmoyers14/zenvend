import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { useFieldControl } from "./Field.tsx";
import { focusRing } from "./focus.ts";

export const controlClass = `w-full rounded-control border border-field bg-card text-body text-ink placeholder:text-muted focus-visible:border-action aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-disabled disabled:text-on-disabled ${focusRing}`;

// Password managers ignore autocomplete="off"; each needs its own opt-out.
// Sign-in is Clerk's, so no field of ours should ever be filled by one.
export const noPasswordManager = {
  "data-1p-ignore": true, // 1Password
  "data-lpignore": "true", // LastPass
  "data-bwignore": true, // Bitwarden
  "data-form-type": "other", // Dashlane
  "data-protonpass-ignore": true, // Proton Pass
} as const;

interface ControlAria {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: InputHTMLAttributes<HTMLInputElement>["aria-invalid"];
}

/** Props the caller set win; otherwise the enclosing `<Field>` supplies them. */
export const useControlAria = (props: ControlAria): ControlAria => {
  const field = useFieldControl();
  return {
    id: props.id ?? field?.id,
    "aria-describedby": props["aria-describedby"] ?? field?.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field?.isInvalid || undefined),
  };
};

export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className = "", type = "text", ...rest }, ref) => {
  const aria = useControlAria(rest);
  return (
    <input
      ref={ref}
      type={type}
      {...noPasswordManager}
      {...rest}
      {...aria}
      className={`${controlClass} h-12 px-3.5 ${className}`}
    />
  );
});
TextInput.displayName = "TextInput";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({ className = "", children, ...rest }, ref) => {
  const aria = useControlAria(rest);
  return (
    <select
      ref={ref}
      {...rest}
      {...aria}
      className={`${controlClass} h-12 cursor-pointer pr-3 pl-3.5 ${className}`}
    >
      {children}
    </select>
  );
});
Select.displayName = "Select";

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className = "", rows = 3, ...rest }, ref) => {
  const aria = useControlAria(rest);
  return (
    <textarea
      ref={ref}
      rows={rows}
      {...noPasswordManager}
      {...rest}
      {...aria}
      className={`${controlClass} min-h-24 resize-y px-3.5 py-3 ${className}`}
    />
  );
});
TextArea.displayName = "TextArea";
