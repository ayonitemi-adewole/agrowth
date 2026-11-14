/* When a routine farm check is due, in Nigerian dates (the database's farm_check_schedule). */

/** Today's date in Nigeria (WAT, UTC+1 all year), as YYYY-MM-DD. */
export const lagosToday = (now = new Date()) =>
  new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);

/** Days from today until a YYYY-MM-DD date: negative once it has passed. */
export function daysUntil(isoDay: string, now = new Date()): number {
  return Math.round(
    (Date.parse(`${isoDay}T00:00:00Z`) - Date.parse(`${lagosToday(now)}T00:00:00Z`)) / 86_400_000,
  );
}

/** "Overdue by 3 days", "Due today", "Due in 5 days". */
export function dueLabel(isoDay: string, now = new Date()): string {
  const n = daysUntil(isoDay, now);
  if (n < 0) return `Overdue by ${-n} day${n === -1 ? '' : 's'}`;
  if (n === 0) return 'Due today';
  return `Due in ${n} day${n === 1 ? '' : 's'}`;
}
