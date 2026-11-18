import { Route, Routes } from "react-router";
import { Shell } from "./components/Shell";
import { ToastProvider } from "./components/Toast";
import { ClinicProvider } from "./lib/clinic";
import { AuthGate } from "./components/AuthGate";
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

export function App() {
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
                <Route path="/recently-deleted" element={<Trash />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="/lab-orders" element={<LabOrders />} />
                <Route path="/reports" element={<ComingNext title="Reports" />} />
                <Route path="/messages" element={<ComingNext title="Messages" />} />
                <Route path="/settings" element={<Settings />} />
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
