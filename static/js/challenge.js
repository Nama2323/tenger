// Task B24: "Challenge a friend" in Beat the physics, with no login, no server and no storage. A challenge link
// carries only the round id, an optional first name, the stars (1–3) and the mode (easy or hard): never the guess,
// the model, the baseline or the real position. Every value read from a link is untrusted: it is validated here,
// a link with any bad value is ignored without an error, and the page shows the values only as text.

/** URL parameters of a challenge (besides page=game and round=<id>). */
export const CHALLENGE_KEYS = { name: 'from', stars: 'stars', mode: 'mode' };
export const NAME_MAX = 20;
const MODES = ['easy', 'hard'];
/** Letters of any script, spaces and hyphens; at least one letter. */
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} -]*$/u;

/**
 * A first name as typed or read from a link: trimmed, inner spaces collapsed. '' when empty (no name); null when it
 * is not allowed (other characters, or longer than 20 characters).
 */
export function cleanName(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) return '';
  if ([...name].length > NAME_MAX || !NAME_PATTERN.test(name)) return null;
  return name;
}

const cleanStars = (value) => (typeof value === 'string' && /^[1-3]$/.test(value) ? Number(value) : (Number.isInteger(value) && value >= 1 && value <= 3 ? value : null));
const cleanMode = (value) => (MODES.includes(value) ? value : null);

/**
 * The challenge link for a round: base (origin and path of the page) plus page, round, and the challenge values.
 * Returns null when a value is not allowed (the caller asks for a valid name instead).
 */
export function challengeUrl(base, { roundId, name = '', stars, mode }) {
  const cleanedName = cleanName(name);
  const cleanedStars = cleanStars(stars);
  const cleanedMode = cleanMode(mode);
  if (cleanedName === null || cleanedStars === null || cleanedMode === null || typeof roundId !== 'string' || !roundId) return null;
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set('page', 'game');
  url.searchParams.set('round', roundId);
  if (cleanedName) url.searchParams.set(CHALLENGE_KEYS.name, cleanedName);
  url.searchParams.set(CHALLENGE_KEYS.stars, String(cleanedStars));
  url.searchParams.set(CHALLENGE_KEYS.mode, cleanedMode);
  return url.toString();
}

/**
 * The challenge in a page's query, or null when there is none or any value is bad (then the link is ignored and no
 * error is shown). roundIds: the rounds that can be played.
 */
export function readChallenge(search, roundIds = []) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(String(search ?? ''));
  if (!params.has(CHALLENGE_KEYS.stars) && !params.has(CHALLENGE_KEYS.mode) && !params.has(CHALLENGE_KEYS.name)) return null;
  const roundId = params.get('round');
  if (!roundId || !roundIds.includes(roundId)) return null;
  const name = cleanName(params.get(CHALLENGE_KEYS.name));
  const stars = cleanStars(params.get(CHALLENGE_KEYS.stars));
  const mode = cleanMode(params.get(CHALLENGE_KEYS.mode));
  if (name === null || stars === null || mode === null) return null;
  return { roundId, name, stars, mode };
}

/** 'win', 'tie' or 'loss' for the friend who took the challenge. */
export function challengeOutcome(myStars, theirStars) {
  if (myStars > theirStars) return 'win';
  if (myStars === theirStars) return 'tie';
  return 'loss';
}

export const starText = (stars) => '★'.repeat(stars);
