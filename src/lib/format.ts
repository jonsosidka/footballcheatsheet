/** Small display helpers shared by the pages. */

/** "Ja'Marr Chase" → "Chase", "Marvin Harrison Jr." → "Harrison". */
export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const rest = parts.slice(1).filter((p) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(p));
  return rest.join(' ') || parts[parts.length - 1];
}

/** 3 → "03". */
export function pad(n: number): string {
  return String(n).padStart(2, '0');
}
