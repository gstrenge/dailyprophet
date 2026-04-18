import { Routes, Route, NavLink } from "react-router-dom";
import UploadPage from "./pages/UploadPage";
import QueuePage from "./pages/QueuePage";
import SettingsPage from "./pages/SettingsPage";
import KioskPage from "./pages/KioskPage";
import KioskViewPage from "./pages/KioskViewPage";
import "./App.css";

export default function App() {
  return (
    <Routes>
      <Route path="/kiosk-view" element={<KioskViewPage />} />
      <Route path="*" element={<AppShell />} />
    </Routes>
  );
}

function AppShell() {
  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead-rule" />
        <p className="masthead-date">{new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
        <h1 className="masthead-title">The Daily Prophet</h1>
        <p className="masthead-tagline">Capturing Moments in Motion Since 1743</p>
        <div className="masthead-rule" />
        <nav className="masthead-nav">
          <NavLink to="/">Upload</NavLink>
          <span className="nav-sep">·</span>
          <NavLink to="/queue">My Clips</NavLink>
          <span className="nav-sep">·</span>
          <NavLink to="/settings">Settings</NavLink>
          <span className="nav-sep">·</span>
          <NavLink to="/kiosk">Kiosk</NavLink>
        </nav>
        <div className="masthead-rule" />
      </header>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/kiosk" element={<KioskPage />} />
        </Routes>
      </main>
    </div>
  );
}
