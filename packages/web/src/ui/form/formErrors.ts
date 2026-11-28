/** An error under each draft field that's wrong. */
export type FieldErrors<Draft> = Partial<Record<keyof Draft, string>>;

/** A copy of `errors` without the given fields' errors. */
export const errorsWithout = <Draft>(
  errors: FieldErrors<Draft>,
  keys: readonly (keyof Draft)[],
): FieldErrors<Draft> => {
  const next = { ...errors };
  for (const key of keys) {
    delete next[key];
  }
  return next;
};

/** True only when a message appears where there was none. */
export const isNewlyShown = ({
  previous,
  current,
}: {
  previous: string | null;
  current: string | null;
}) => previous === null && current !== null;
