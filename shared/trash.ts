/** Deleted items wait in Recently deleted for this many days. */
export const KEEP_DAYS = 30;

const DAY = 24 * 60 * 60 * 1000;

export function removalDate(deletedAt: string): Date {
  return new Date(new Date(deletedAt).getTime() + KEEP_DAYS * DAY);
}

/** Whole days left before permanent removal (0 means it goes tonight). */
export function daysLeft(deletedAt: string, now: Date = new Date()): number {
  const ms = removalDate(deletedAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / DAY));
}

/** Cut-off for the nightly purge: anything deleted before this is removed. */
export function purgeBefore(now: Date = new Date()): string {
  return new Date(now.getTime() - KEEP_DAYS * DAY).toISOString();
}
