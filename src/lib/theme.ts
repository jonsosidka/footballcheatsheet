/** Explicit theme choices. No value means "follow the system". */
export type Theme = 'light' | 'dark';

export const THEME_COOKIE = 'theme';

export function parseTheme(value: string | undefined | null): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}
