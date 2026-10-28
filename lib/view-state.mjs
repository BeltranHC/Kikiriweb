const PREFIX = 'kikiriweb:view:';
export function normalizeSearchState(value) {
  return {
    query: typeof value?.query === 'string' ? value.query.slice(0, 200) : '',
    page: Number.isSafeInteger(value?.page) && value.page > 0 && value.page <= 1000000 ? value.page : 1,
  };
}
export function readSearchState(storage, key) {
  try { return normalizeSearchState(JSON.parse(storage.getItem(PREFIX + key))); }
  catch { return normalizeSearchState(null); }
}
export function writeSearchState(storage, key, value) {
  try { storage.setItem(PREFIX + key, JSON.stringify(normalizeSearchState(value))); } catch { /* Storage can be unavailable. */ }
}
export function clearSearchStates(storage) {
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(key => key?.startsWith(PREFIX));
    keys.forEach(key => storage.removeItem(key));
  } catch { /* Explicit logout must still work when storage is unavailable. */ }
}
