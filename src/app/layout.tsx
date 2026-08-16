import type { Metadata } from 'next';
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${instrument.variable} ${archivo.variable} ${jetbrains.variable} antialiased`}>
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
