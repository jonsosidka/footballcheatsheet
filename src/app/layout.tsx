import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { Archivo, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ResumeRefresh } from '@/components/ResumeRefresh';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';

/*
 * Archivo carries the whole voice: its width axis runs from condensed to
 * 125% expanded, so the headline face, the player names and the body copy are
 * one family at three widths rather than three fonts.
 */
const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-archivo',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-jetbrains',
});

export const metadata: Metadata = {
  title: 'Cheatsheet — Fantasy Supply Co.',
  description: 'Lineup, waiver, trade and draft calls for your Sleeper dynasty and redraft leagues.',
  applicationName: 'Cheatsheet',
  /*
   * Added to the home screen this should launch chromeless, like an app the
   * phone shipped with. `black-translucent` puts the page behind the status
   * bar, which is why every piece of top chrome pads itself by
   * `env(safe-area-inset-top)` rather than assuming a zero origin.
   */
  appleWebApp: {
    capable: true,
    title: 'Cheatsheet',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    // Player names and point totals are not phone numbers; iOS disagrees and
    // turns them into blue tappable links unless told otherwise.
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /*
   * `cover` is what makes the safe-area env() values non-zero — without it iOS
   * letterboxes the page inside the notch cutout.
   */
  viewportFit: 'cover',
  // Matches --color-ink in each theme, so the status bar and the overscroll
  // are the same colour as the page.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0c' },
    { media: '(prefers-color-scheme: light)', color: '#f2f0ea' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /*
   * The theme is read on the server so the first paint is already right. With
   * no cookie the attribute is left off and the stylesheet follows the
   * system; the toggle writes the cookie once someone picks.
   */
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    /*
     * The font variables belong on <html>, not <body>: globals.css composes
     * them at `:root`, and a custom property resolves in the scope it is
     * declared in.
     */
    <html
      lang="en"
      data-theme={theme ?? undefined}
      className={`${archivo.variable} ${jetbrains.variable}`}
    >
      <body className="antialiased">
        {children}
        <ResumeRefresh />
      </body>
    </html>
  );
}
