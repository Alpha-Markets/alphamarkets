/// Shown while a page's code or data is on its way (the first visit to a page, above all under
/// `next dev`, which builds each page when it is first opened). A slim bar at the very top, so it
/// never shifts the layout; it fades in after a moment so a fast navigation shows nothing at all.
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="nav-progress pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
      <span className="nav-progress-bar block h-full w-1/3 bg-accent" />
    </div>
  );
}
