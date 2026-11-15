/** Browser-safe: no server imports here. Reads a structuredResponse body. */
export async function readStructured<T>(res: Response): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const text = (await res.text()).trim();
    const payload = text ? JSON.parse(text) : null;
    if (!res.ok || !payload || payload.error) return { ok: false, error: payload?.error ?? `Request failed (${res.status}).` };
    return { ok: true, data: payload as T };
  } catch {
    return { ok: false, error: 'Lost the connection to Claude.' };
  }
}
