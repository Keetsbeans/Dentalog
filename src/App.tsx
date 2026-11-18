import { Route, Routes, useLocation } from "react-router";
import { Shell } from "./components/Shell";
import { ToastProvider } from "./components/Toast";
import { ClinicProvider } from "./lib/clinic";
import { AuthGate, useMe } from "./components/AuthGate";
import type { Perm } from "../shared/roles";
import type { ReactNode } from "react";
import { Today } from "./pages/Today";
import { Calendar } from "./pages/Calendar";
import { Patients } from "./pages/Patients";
import { PatientRecord } from "./pages/PatientRecord";
import { Visit } from "./pages/Visit";
import { PrintRx } from "./pages/PrintRx";
import { PrintReceipt } from "./pages/PrintReceipt";
import { Billing } from "./pages/Billing";
import { Settings } from "./pages/Settings";
import { LabOrders } from "./pages/LabOrders";
import { Trash } from "./pages/Trash";
import { ComingNext } from "./pages/ComingNext";
import { Reports } from "./pages/Reports";
import { Messages } from "./pages/Messages";
import { Confirm } from "./pages/Confirm";
import { MyAccount } from "./pages/MyAccount";

export function App() {
  // The patient's appointment link needs no sign-in.
  if (useLocation().pathname.startsWith("/c/")) return <Routes><Route path="/c/:token" element={<Confirm />} /></Routes>;
  return (
    <AuthGate>
    <ClinicProvider>
      <ToastProvider>
        <Routes>
          {/* Printouts have no menu, so the page is just the A4 sheet. */}
          <Route path="/print/rx/:id" element={<PrintRx />} />
          <Route path="/print/receipt/:id" element={<PrintReceipt />} />
          <Route path="*" element={
            <Shell>
              <Routes>
                <Route path="/" element={<Today />} />
                <Route path="/calendar" element={<Calendar />} />
                <Route path="/patients" element={<Patients />} />
                <Route path="/patients/:id" element={<PatientRecord />} />
                <Route path="/visits/:id" element={<Visit />} />
                <Route path="/recently-deleted" element={<Need perm="delete"><Trash /></Need>} />
                <Route path="/billing" element={<Need perm="billing.view"><Billing /></Need>} />
                <Route path="/lab-orders" element={<LabOrders />} />
                <Route path="/reports" element={<Need perm="money.totals"><Reports /></Need>} />
                <Route path="/messages" element={<Need perm="messages.send"><Messages /></Need>} />
                <Route path="/settings" element={<Need perm="settings"><Settings /></Need>} />
                <Route path="/account" element={<MyAccount />} />
                <Route path="*" element={<ComingNext title="Page not found" />} />
              </Routes>
            </Shell>
          } />
        </Routes>
      </ToastProvider>
    </ClinicProvider>
    </AuthGate>
  );
}

/** A page some logins can't open. */
function Need({ perm, children }: { perm: Perm; children: ReactNode }) {
  if (useMe().can(perm)) return <>{children}</>;
  return <><h1>Not open to your login</h1><div className="card empty">Ask the clinic owner if you need this page.</div></>;
}
