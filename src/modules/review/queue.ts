/** Remove only the successfully submitted item. Skipped items stay in this batch. */
export function afterSubmission<T extends { id: string }>(
  items: T[],
  id: string,
  index: number,
) {
  const remaining = items.filter((item) => item.id !== id);
  return {
    items: remaining,
    index: remaining.length ? index % remaining.length : 0,
    complete: remaining.length === 0,
  };
}
