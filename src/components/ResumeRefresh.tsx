'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Pick the app back up where the calendar is, not where it was left.
 *
 * A home-screen app is rarely closed — iOS freezes it in the background and
 * thaws it days later with the old render still on screen, no request made.
 * The proxy that resets a stale week only sees document loads, so a thawed
 * page would keep showing last week until something navigated. After a long
 * enough absence this treats the return like a fresh launch: drop any pinned
 * week and re-render from the server.
 */

/** Away this long counts as a new session. */
const STALE_AFTER_MS = 30 * 60 * 1000;

export function ResumeRefresh() {
  const router = useRouter();

  useEffect(() => {
    let hiddenAt: number | null = null;

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt === null || Date.now() - hiddenAt < STALE_AFTER_MS) return;
      hiddenAt = null;

      const url = new URL(window.location.href);
      if (url.searchParams.has('week')) {
        url.searchParams.delete('week');
        router.replace(`${url.pathname}${url.search}`);
      } else {
        router.refresh();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [router]);

  return null;
}
