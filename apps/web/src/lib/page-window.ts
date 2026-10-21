/** One slot of a page navigator: a 0-based page, or an ellipsis standing in for hidden pages. */
export type PageSlot = number | "gap-start" | "gap-end";

/**
 * Pages to show in a navigator: the first, the last and the neighbours of the
 * current one. A gap that would hide a single page shows that page instead,
 * so an ellipsis always stands for at least two.
 */
export function pageWindow(
  current: number,
  pageCount: number,
  siblings = 1,
): PageSlot[] {
  if (pageCount <= 0) return [];
  const last = pageCount - 1;
  const from = Math.max(1, current - siblings);
  const to = Math.min(last - 1, current + siblings);
  const slots: PageSlot[] = [0];
  if (from === 2) slots.push(1);
  else if (from > 2) slots.push("gap-start");
  for (let page = from; page <= to; page += 1) slots.push(page);
  if (to === last - 2) slots.push(last - 1);
  else if (to < last - 2) slots.push("gap-end");
  if (last > 0) slots.push(last);
  return slots;
}
