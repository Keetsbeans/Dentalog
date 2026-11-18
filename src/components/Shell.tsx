import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { useClinic } from "../lib/clinic";
import { imageUrl } from "../lib/api";
import { signOut, useMe } from "./AuthGate";
import { ROLE_LABEL, type Perm } from "../../shared/roles";

/** Each page, and the permission it needs (none = everyone). */
const NAV: [string, string, Perm?][] = [
  ["Today", "/"], ["Calendar", "/calendar"], ["Patients", "/patients"], ["Billing", "/billing", "billing.view"],
  ["Lab orders", "/lab-orders"], ["Reports", "/reports", "money.totals"], ["Messages", "/messages", "messages.send"],
  ["Settings", "/settings", "settings"], ["Recently deleted", "/recently-deleted", "delete"],
];

export function Shell({ children }: { children: ReactNode }) {
  const { clinic } = useClinic();
  const { user, can } = useMe();
  return (
    <div className="app">
      <nav className="side" aria-label="Main">
        <div className="brand">
          <div className="brand-row">
            <img src="/icon.svg" alt="" width={38} height={38} />
            <span className="brand-name">Dentalog</span>
          </div>
          <div className="clinic-row">
            <img src={imageUrl(clinic, "logo")!} alt="" width={22} height={22} />
            <span>{clinic?.name ?? "Oyster Dental Care"}</span>
          </div>
        </div>
        {NAV.filter(([, , p]) => !p || can(p)).map(([label, to]) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}>
            {label}
          </NavLink>
        ))}
        <NavLink to="/account" className={({ isActive }) => "nav-link me-link" + (isActive ? " active" : "")}>
          <b>{user.name}</b><span className="muted">{ROLE_LABEL[user.role]}</span>
        </NavLink>
        <button type="button" className="nav-link signout" onClick={signOut}>Sign out</button>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
