import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router";
import { api, type Clinic } from "../lib/api";

const NAV: [string, string][] = [
  ["Today", "/"], ["Calendar", "/calendar"], ["Patients", "/patients"], ["Billing", "/billing"],
  ["Lab orders", "/lab-orders"], ["Reports", "/reports"], ["Messages", "/messages"],
  ["Settings", "/settings"], ["Recently deleted", "/recently-deleted"],
];

export function Shell({ children }: { children: ReactNode }) {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  useEffect(() => { api<Clinic>("/clinic").then(setClinic).catch(() => setClinic(null)); }, []);
  return (
    <div className="app">
      <nav className="side" aria-label="Main">
        <div className="brand">
          <div className="brand-row">
            <img src="/icon.svg" alt="" width={38} height={38} />
            <span className="brand-name">Dentalog</span>
          </div>
          <div className="clinic-row">
            <img src="/clinic-logo.png" alt="" width={22} height={22} />
            <span>{clinic?.name ?? "Oyster Dental Care"}</span>
          </div>
        </div>
        {NAV.map(([label, to]) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            {label}
          </NavLink>
        ))}
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
