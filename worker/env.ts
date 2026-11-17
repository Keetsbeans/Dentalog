export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
}

/** Until multi-clinic sign-in exists, everything belongs to Oyster Dental Care. */
export const CLINIC_ID = "oyster";
