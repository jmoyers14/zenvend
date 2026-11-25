import type { QueryKey } from "@tanstack/react-query";
import { type NavigateOptions, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { queryClient } from "../trpc.ts";
import { useFormDraft } from "../ui.tsx";
import { errorsWithout, type FieldErrors, isNewlyShown } from "./recordForm.ts";

interface RecordFormOptions<Draft extends object, Saved> {
  /** Present means edit. */
  recordId: string | undefined;
  /** The fetched record; the draft loads from it once. */
  record: Saved | null | undefined;
  emptyDraft: Draft;
  draftFor: (record: Saved) => Draft;
  /** Where a save and a cancel land. */
  listPath: NavigateOptions["to"];
  /** Marked stale after a save. */
  savedQueryKey: QueryKey;
}

/**
 * The plumbing a create + edit screen shares: the draft, its errors, saving,
 * and dismissing. The screen keeps its own query, mutations and submit.
 */
export const useRecordForm = <Draft extends object, Saved>({
  recordId,
  record,
  emptyDraft,
  draftFor,
  listPath,
  savedQueryKey,
}: RecordFormOptions<Draft, Saved>) => {
  const navigate = useNavigate();
  const isEditing = Boolean(recordId);
  const { draft, set, load, discard, isDirty } = useFormDraft<Draft>(emptyDraft);
  const [errors, setErrors] = useState<FieldErrors<Draft>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Loaded once: a refetch on window focus must not wipe edits in progress.
  const [hasLoaded, setHasLoaded] = useState(false);
  const formErrorRef = useRef<HTMLDivElement>(null);
  const previousFormErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!record || hasLoaded) {
      return;
    }
    setHasLoaded(true);
    load(draftFor(record));
  }, [record, hasLoaded, load, draftFor]);

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

  const saveCallbacks = {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: savedQueryKey });
      navigate({ to: listPath });
    },
    onError: (error: { message: string }) => setFormError(error.message),
  };

  const handleDismiss = () => {
    if (!isEditing) {
      navigate({ to: listPath });
      return;
    }
    discard();
    setErrors({});
    setFormError(null);
  };

  return {
    draft,
    isDirty,
    isEditing,
    hasLoaded,
    // Nothing to edit until the record arrives; a failed load must not save over it.
    canShowForm: !isEditing || hasLoaded,
    errors,
    setErrors,
    clearErrors,
    formError,
    setFormError,
    formErrorRef,
    editDraft,
    saveCallbacks,
    handleDismiss,
  };
};
