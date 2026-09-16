const STORAGE_KEY = 'oblik-demo-v1';
export const storageService = {
  load<T>(): T | null {
    if (typeof window === 'undefined') return null;
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) as T : null; }
    catch { return null; }
  },
  save<T>(value: T) { if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); },
  clear() { if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY); },
};
