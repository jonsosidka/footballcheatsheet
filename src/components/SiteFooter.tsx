import Link from 'next/link';

/** Small print and the page-wide outline wordmark that closes every page. */
export function SiteFooter() {
  return (
    <footer className="border-t border-rule mt-2 overflow-hidden">
      <div className="shell pt-3.5 flex flex-wrap justify-between gap-2 font-mono text-[10px] tracking-[0.18em] uppercase text-text-faint">
        <span>Made for Sundays</span>
        <span>Projections restock hourly</span>
        <Link href="/kit" className="text-text-faint hover:text-text">
          Design kit
        </Link>
      </div>
      <div
        aria-hidden="true"
        className="display text-[11.6vw] leading-[0.8] tracking-[-0.04em] text-transparent whitespace-nowrap text-center pt-2.5 -mb-[1.5vw] select-none"
        style={{ WebkitTextStroke: '1px var(--color-rule-bright)' }}
      >
        CHEATSHEET
      </div>
    </footer>
  );
}
