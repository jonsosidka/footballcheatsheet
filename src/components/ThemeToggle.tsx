'use client';

import { useSyncExternalStore } from 'react';
import { THEME_COOKIE, type Theme } from '@/lib/theme';

/**
 * Flip between paper and ink.
 *
 * The page starts on whatever the server set from the cookie, or on the
 * system preference when there is none, so the showing theme is read from the
 * document rather than held in state: the `data-theme` attribute when set,
 * the media query otherwise. A tap writes the attribute straight onto <html>
 * — nothing re-renders — and a year-long cookie so the server paints the same
 * theme next time.
 */

const media = () => window.matchMedia('(prefers-color-scheme: light)');

function current(): Theme {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return media().matches ? 'light' : 'dark';
}

function subscribe(onChange: () => void) {
  const query = media();
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  query.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    query.removeEventListener('change', onChange);
  };
}

export function useTheme(): Theme | null {
  return useSyncExternalStore(subscribe, current, () => null);
}

export function setTheme(next: Theme) {
  document.documentElement.dataset.theme = next;
  document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
}

/** Back to following the system: drop the attribute and the cookie. */
export function followSystem() {
  delete document.documentElement.dataset.theme;
  document.cookie = `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/** Explicit chooser, three ways: light, dark, or whatever the system says. */
export function ThemePicker({ initial = null }: { initial?: Theme | null }) {
  const theme = useTheme();
  const explicit = useSyncExternalStore(
    subscribe,
    () => document.documentElement.dataset.theme ?? null,
    // The server knows the cookie, so the first paint marks the right button.
    () => initial,
  );
  const options = [
    { id: 'dark', label: 'Dark', pick: () => setTheme('dark') },
    { id: 'light', label: 'Light', pick: () => setTheme('light') },
    { id: 'system', label: 'System', pick: followSystem },
  ] as const;
  return (
    <div role="group" aria-label="Theme" className="inline-flex border border-text">
      {options.map((o) => {
        const on = o.id === 'system' ? explicit === null : explicit === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={o.pick}
            aria-pressed={on}
            className={`btn !border-0 !min-h-[2.5rem] ${on ? 'bg-text text-ink' : 'text-text hover:bg-ink-hover'}`}
          >
            {o.label}
            {o.id === 'system' && on && theme ? <span className="opacity-60">· {theme}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useTheme();
  const label = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';

  return (
    <button
      type="button"
      onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      aria-label={label}
      title={label}
      className={`btn btn-outline chrome press !px-0 w-10 md:w-[2.625rem] ${className}`}
    >
      {/* Half-filled disc: reads as "theme" in either state. */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
      </svg>
    </button>
  );
}
