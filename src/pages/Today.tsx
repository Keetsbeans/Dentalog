import { Link } from "react-router";

export function Today() {
  const today = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date());
  return (
    <>
      <p className="eyebrow">{today} · Open 3:30 – 8:30 PM</p>
      <h1>Today</h1>
      <div className="card empty">
        Today’s patient queue arrives with the calendar. For now, <Link to="/patients">add and find patients</Link>.
      </div>
    </>
  );
}
