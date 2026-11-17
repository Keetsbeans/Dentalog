import { Route, Routes } from "react-router";
import { Shell } from "./components/Shell";
import { ToastProvider } from "./components/Toast";
import { Today } from "./pages/Today";
import { Patients } from "./pages/Patients";
import { Trash } from "./pages/Trash";
import { ComingNext } from "./pages/ComingNext";
import { Calendar } from "./pages/Calendar";
import { ClinicProvider } from "./lib/clinic";

export function App() {
  return (
    <ClinicProvider>
    <ToastProvider>
      <Shell>
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/patients" element={<Patients />} />
          <Route path="/recently-deleted" element={<Trash />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/billing" element={<ComingNext title="Billing" />} />
          <Route path="/lab-orders" element={<ComingNext title="Lab orders" />} />
          <Route path="/reports" element={<ComingNext title="Reports" />} />
          <Route path="/messages" element={<ComingNext title="Messages" />} />
          <Route path="/settings" element={<ComingNext title="Settings" />} />
          <Route path="*" element={<ComingNext title="Page not found" />} />
        </Routes>
      </Shell>
    </ToastProvider>
    </ClinicProvider>
  );
}
