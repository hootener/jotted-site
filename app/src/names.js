// Docker-style default names: adjective-adjective-animal, derived
// deterministically from a jot's ULID so existing jots get stable names.

export const ADJECTIVES = [
  'able', 'amber', 'ancient', 'bold', 'brave', 'bright', 'brisk', 'calm', 'candid', 'cheeky', 'civil', 'clever',
  'cosmic', 'crisp', 'curious', 'daring', 'dapper', 'eager', 'earnest', 'elegant', 'excited', 'fancy', 'fearless',
  'fierce', 'frank', 'gentle', 'giddy', 'glad', 'golden', 'graceful', 'gullible', 'happy', 'hardy', 'hasty', 'honest',
  'hopeful', 'humble', 'jolly', 'keen', 'kind', 'lively', 'loyal', 'lucky', 'merry', 'mellow', 'modest', 'nimble',
  'noble', 'odd', 'patient', 'peppy', 'plucky', 'polite', 'proud', 'quick', 'quiet', 'rapid', 'restless', 'rowdy',
  'rustic', 'serene', 'sharp', 'shy', 'silly', 'sleepy', 'sly', 'snappy', 'spry', 'stoic', 'sunny', 'swift', 'tender',
  'tidy', 'tiny', 'trusty', 'vivid', 'wary', 'wild', 'witty', 'zany', 'zesty',
];

export const ANIMALS = [
  'ant', 'badger', 'bat', 'bear', 'beaver', 'bee', 'bison', 'camel', 'cat', 'cobra', 'crab', 'crane', 'crow', 'deer',
  'dingo', 'dolphin', 'donkey', 'dove', 'duck', 'eagle', 'eel', 'elk', 'falcon', 'ferret', 'finch', 'fox', 'frog',
  'gecko', 'gibbon', 'goat', 'goose', 'hare', 'hawk', 'heron', 'hippo', 'horse', 'ibis', 'iguana', 'jackal', 'jay',
  'koala', 'lark', 'lemur', 'lion', 'llama', 'lynx', 'mole', 'moose', 'moth', 'mouse', 'newt', 'otter', 'owl', 'ox',
  'panda', 'parrot', 'pelican', 'penguin', 'pike', 'puma', 'quail', 'rabbit', 'raven', 'robin', 'seal', 'shark',
  'sloth', 'snail', 'sparrow', 'squid', 'stork', 'swan', 'tapir', 'tiger', 'toad', 'trout', 'turtle', 'viper',
  'walrus', 'wasp', 'whale', 'wolf', 'wombat', 'yak', 'zebra',
];

/** Small deterministic hash (FNV-1a) of a string. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Default display name for a jot id, e.g. "excited-gullible-hippo". */
export function defaultName(id) {
  const a = fnv1a(`a:${id}`) % ADJECTIVES.length;
  let b = fnv1a(`b:${id}`) % ADJECTIVES.length;
  if (b === a) b = (b + 1) % ADJECTIVES.length;
  const c = fnv1a(`c:${id}`) % ANIMALS.length;
  return `${ADJECTIVES[a]}-${ADJECTIVES[b]}-${ANIMALS[c]}`;
}

export function cleanName(raw, fallback) {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  return s || fallback;
}
