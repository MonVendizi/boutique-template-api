/** Cache mémoire simple pour éviter de brûler le quota GA4 (RESOURCE_EXHAUSTED). */

const store = new Map();

/**
 * @template T
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<T>} loader
 * @returns {Promise<T>}
 */
export async function withGa4Cache(key, ttlMs, loader) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) {
    return hit.value;
  }
  const value = await loader();
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

export function clearGa4Cache(prefix = "") {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function isGa4QuotaError(err) {
  const msg = err instanceof Error ? err.message : String(err || "");
  return /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg);
}

export function ga4QuotaUserMessage(err) {
  if (!isGa4QuotaError(err)) {
    return err instanceof Error ? err.message : String(err || "Erreur GA4");
  }
  return (
    "Quota Google Analytics temporairement épuisé (trop d'appels API). " +
    "Réessayez dans ~1 h — les données en cache s'afficheront dès que possible."
  );
}
