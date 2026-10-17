// In-memory Storage for node tests. Save slots and settings read through
// `globalThis.localStorage`, which tests replace with this.

export function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length(): number {
      return m.size;
    },
    clear: (): void => m.clear(),
    getItem: (key: string): string | null => m.get(key) ?? null,
    key: (index: number): string | null => [...m.keys()][index] ?? null,
    removeItem: (key: string): void => {
      m.delete(key);
    },
    setItem: (key: string, value: string): void => {
      m.set(key, String(value));
    },
  };
}
