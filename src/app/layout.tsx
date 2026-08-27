import type { Metadata, Viewport } from 'next';
import { Instrument_Serif, Archivo, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const instrument = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-instrument',
});

const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
});

export const metadata: Metadata = {
  title: 'Football Cheatsheet',
  description: 'Market-aware lineup and roster management for Sleeper dynasty and redraft leagues.',
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
   * letterboxes the page inside the notch cutout instead of letting the header
   * blur run to the physical top edge.
   */
  viewportFit: 'cover',
  // Matches --color-ink, so the status bar and the pull-down overscroll are
  // the same near-black as the page.
  themeColor: '#08090b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * The font variables belong on <html>, not <body>: globals.css composes
     * them at `:root` (`--font-body: var(--font-archivo), sans-serif`), and a
     * custom property resolves in the scope it is *declared* in. Declared one
     * level below, --font-archivo was invisible to that composition, so
     * --font-body resolved to nothing and the whole app fell back to Times.
     */
    <html
      lang="en"
      className={`${instrument.variable} ${archivo.variable} ${jetbrains.variable}`}
    >
      <body className="antialiased">
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
