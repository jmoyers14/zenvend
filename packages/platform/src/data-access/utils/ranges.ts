/**
 * Inclusive `$gte`/`$lte` bounds for a window of ISO instants, or null when
 * neither end is set. Dates, not strings: a `$match` stage is not cast by
 * Mongoose, and a string bound there matches nothing.
 */
export function instantBounds(range: {
  from?: string | null;
  to?: string | null;
}): Record<string, Date> | null {
  const bounds: Record<string, Date> = {};
  if (range.from) {
    bounds.$gte = new Date(range.from);
  }
  if (range.to) {
    bounds.$lte = new Date(range.to);
  }
  return Object.keys(bounds).length > 0 ? bounds : null;
}
