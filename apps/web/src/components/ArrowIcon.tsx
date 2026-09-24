/// The small up-right arrow that marks a link which opens something, as on the reference's list rows
/// and buttons. Decorative: the link's text names the destination.
export function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.25" className={className ?? "size-3"}>
      <path d="M3.5 2.5h6v6M9.5 2.5l-7 7" strokeLinecap="square" />
    </svg>
  );
}
