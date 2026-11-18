export interface Env {
  DB: D1Database;
  /** File storage for X-rays and photos. Added when uploads arrive; R2 asks for a card on sign-up. */
  FILES?: R2Bucket;
  ASSETS: Fetcher;
  /** The clinic's login password, set as a secret in Cloudflare (Settings → Variables and secrets). */
  DENTALOG_PASSWORD?: string;
}

/** Until multi-clinic sign-in exists, everything belongs to Oyster Dental Care. */
export const CLINIC_ID = "oyster";
