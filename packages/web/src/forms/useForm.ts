import { useEffect, useRef, useState } from "react";
import { errorsWithout, type FieldErrors, isNewlyShown } from "./formErrors.ts";
import { useFormDraft } from "./useFormDraft.ts";

/**
 * A form's draft and everything that can be wrong with it: an error under each
 * field, and one for the whole form when a save is refused.
 */
export const useForm = <Draft extends object>(initialDraft: Draft) => {
  const { draft, set, load, discard, isDirty } = useFormDraft<Draft>(initialDraft);
  const [errors, setErrors] = useState<FieldErrors<Draft>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);
  const previousFormErrorRef = useRef<string | null>(null);

  // Save is pressed at the bottom of a tall page; bring a refusal into view there.
  useEffect(() => {
    const previous = previousFormErrorRef.current;
    previousFormErrorRef.current = formError;
    if (isNewlyShown({ previous, current: formError })) {
      formErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [formError]);

  const clearErrors = (keys: readonly (keyof Draft)[]) =>
    setErrors((current) => errorsWithout(current, keys));

  // An edit clears that field's error, so a fix doesn't keep showing it.
  const editDraft = (patch: Partial<Draft>) => {
    set(patch);
    clearErrors(Object.keys(patch) as (keyof Draft)[]);
  };

  const reset = () => {
    discard();
    setErrors({});
    setFormError(null);
  };

  return {
    draft,
    isDirty,
    load,
    editDraft,
    reset,
    errors,
    setErrors,
    clearErrors,
    formError,
    setFormError,
    formErrorRef,
  };
};
