import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { type NavigateOptions, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "./useForm.ts";

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
 * A form that creates or edits one saved record: `useForm`, plus loading the
 * record, saving back to its list, and dismissing. The screen keeps its own
 * query, mutations and submit.
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
  const queryClient = useQueryClient();
  const form = useForm(emptyDraft);
  const { load, reset, setFormError } = form;
  const isEditing = Boolean(recordId);
  // Loaded once: a refetch on window focus must not wipe edits in progress.
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (!record || hasLoaded) {
      return;
    }
    setHasLoaded(true);
    load(draftFor(record));
  }, [record, hasLoaded, load, draftFor]);

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
    reset();
  };

  return {
    ...form,
    isEditing,
    hasLoaded,
    // Nothing to edit until the record arrives; a failed load must not save over it.
    canShowForm: !isEditing || hasLoaded,
    saveCallbacks,
    handleDismiss,
  };
};
