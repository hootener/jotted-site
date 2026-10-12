// Crockford base32 alphabet used by ULID (no I, L, O, U).
const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function ulid(now = Date.now(), rng = defaultRng) {
  let t = now;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = ENC[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = rng(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += ENC[bytes[i] & 31];
  return time + rand;
}

export function isUlid(s) {
  return typeof s === 'string' && ULID_RE.test(s);
}

function defaultRng(n) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}
