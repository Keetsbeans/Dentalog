import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Clinic } from "./api";
import type { Hours } from "../../shared/time";

/** Mon–Sat 3:30–8:30 PM until the clinic row loads. */
const FALLBACK: Hours = { mon: ["15:30", "20:30"], tue: ["15:30", "20:30"], wed: ["15:30", "20:30"], thu: ["15:30", "20:30"], fri: ["15:30", "20:30"], sat: ["15:30", "20:30"], sun: null };

const Ctx = createContext<{ clinic: Clinic | null; hours: Hours }>({ clinic: null, hours: FALLBACK });

export function ClinicProvider({ children }: { children: ReactNode }) {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  useEffect(() => { api<Clinic>("/clinic").then(setClinic).catch(() => setClinic(null)); }, []);
  let hours = FALLBACK;
  try { if (clinic) hours = JSON.parse(clinic.hoursJson) as Hours; } catch { /* keep fallback */ }
  return <Ctx.Provider value={{ clinic, hours }}>{children}</Ctx.Provider>;
}

export const useClinic = () => useContext(Ctx);
