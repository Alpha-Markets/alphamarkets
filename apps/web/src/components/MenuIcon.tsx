/// The menu button's icon: three bars, or a cross while the menu is open. Decorative: the button carries
/// the accessible name.
export function MenuIcon({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className={className ?? "size-5"}>
      {open ? <path d="M4.5 4.5l11 11M15.5 4.5l-11 11" /> : <path d="M3 5.5h14M3 10h14M3 14.5h14" />}
    </svg>
  );
}
