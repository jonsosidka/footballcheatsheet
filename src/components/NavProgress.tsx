'use client';

/**
 * The thin bar under the header while a route change is in flight.
 *
 * Picking a league is a server round trip on these `force-dynamic` pages. iOS
 * dismisses a picker the instant you choose — holding the sheet open to show
 * progress would be the wrong gesture — so the sheet closes immediately and
 * the wait is reported here instead, the way Safari reports a page load.
 */
export function NavProgress({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      role="progressbar"
      aria-label="Loading"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden"
    >
      <div className="nav-progress h-full w-1/3 bg-signal" />
    </div>
  );
}
