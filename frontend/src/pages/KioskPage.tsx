export default function KioskPage() {
  return (
    <div>
      <h2 className="section-heading" style={{ marginBottom: "0.5rem" }}>
        Kiosk
      </h2>
      <hr className="rule" />
      <p
        style={{
          fontSize: "0.85rem",
          fontStyle: "italic",
          margin: "0.75rem 0 1.25rem",
        }}
      >
        On the Pi, Chromium opens <code>/kiosk-view</code> fullscreen
        automatically. To preview on this machine, open the link below and press
        F11 for fullscreen.
      </p>
      <a
        href="/kiosk-view"
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-primary"
      >
        Open Kiosk View
      </a>
    </div>
  );
}
