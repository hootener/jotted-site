// The bundled "what's new" jot: a fixed, valid ULID so it has a stable file
// name and URL, plus helpers shared by the stores and the list page.
export const WHATS_NEW_ID = '0000000000000000WHATSNEW00';

export function isWhatsNew(id) {
  return id === WHATS_NEW_ID;
}

/**
 * True if the bundled copy should replace what the user has: nothing local,
 * or a local/dismissed copy older than the bundle. `dismissedAt` is the stamp
 * of a copy the user deleted, so it only comes back when a newer one ships.
 */
export function shouldSeed(existing, bundled, dismissedAt = 0) {
  if (!bundled || bundled.id !== WHATS_NEW_ID) return false;
  const seen = Math.max(existing?.bundledAt ?? 0, dismissedAt ?? 0);
  return (bundled.bundledAt ?? 0) > seen;
}

/** The copy to store locally: fresh updatedAt so it sorts to the top. */
export function seededCopy(bundled, now = Date.now()) {
  return { ...structuredClone(bundled), builtin: true, updatedAt: now };
}
