import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type Clinic } from "./api";
import type { Hours } from "../../shared/time";
import { DEFAULT_SETTINGS, type ClinicSettings } from "../../shared/settings";

/** Mon–Sat 3:30–8:30 PM until the clinic row loads. */
const FALLBACK: Hours = { mon: ["15:30", "20:30"], tue: ["15:30", "20:30"], wed: ["15:30", "20:30"], thu: ["15:30", "20:30"], fri: ["15:30", "20:30"], sat: ["15:30", "20:30"], sun: null };

type Ctx = { clinic: Clinic | null; hours: Hours; settings: ClinicSettings; reload: () => Promise<void> };
const C = createContext<Ctx>({ clinic: null, hours: FALLBACK, settings: DEFAULT_SETTINGS, reload: async () => {} });

export function ClinicProvider({ children }: { children: ReactNode }) {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const reload = useCallback(async () => { try { setClinic(await api<Clinic>("/clinic")); } catch { /* keep what we have */ } }, []);
  useEffect(() => { reload(); }, [reload]);
  let hours = FALLBACK;
  try { if (clinic) hours = JSON.parse(clinic.hoursJson) as Hours; } catch { /* keep fallback */ }
  return <C.Provider value={{ clinic, hours, settings: clinic?.settings ?? DEFAULT_SETTINGS, reload }}>{children}</C.Provider>;
}

export const useClinic = () => useContext(C);
