import { NextResponse, type NextRequest } from 'next/server';

/**
 * A new session starts on the week it actually is.
 *
 * `?week=` is how a chosen week survives moving between tabs, but a URL
 * outlives the session it was made in: a restored browser tab, a bookmark, or
 * the home-screen app reopening where it left off all replay it, and an
 * explicit week outranks the live one — so the app opened on week 1 in week 3.
 *
 * Only full document loads are touched. In-app navigation (tabs, the week
 * picker, league switching) goes through the client router as a fetch, so a
 * week picked mid-session sticks; opening the app, reloading, or restoring a
 * tab lands on the live week. `Sec-Fetch-Dest` is what tells the two apart.
 */
export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  if (!url.searchParams.has('week')) return NextResponse.next();
  if (request.headers.get('sec-fetch-dest') !== 'document') return NextResponse.next();

  url.searchParams.delete('week');
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/', '/waivers', '/trades', '/draft', '/setup'],
};
