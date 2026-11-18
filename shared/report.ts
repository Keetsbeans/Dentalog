/** What GET /api/reports returns. */
export type Bucket = { key: string; collectedPaise: number; visits: number };
export type Report = {
  from: string; to: string; by: "day" | "month";
  collectedPaise: number; billedPaise: number; labPaise: number;
  visits: number; newPatients: number;
  booked: number; came: number; noShows: number; cancelled: number;
  outstandingPaise: number; owing: { id: string; name: string; code: string; balancePaise: number }[];
  modes: { mode: string; paise: number; count: number }[];
  services: { service: string; count: number; paise: number }[];
  series: Bucket[];
};
