/** Letters that can't be misread for each other (no I/1, O/0). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A short room code people can read out loud, e.g. "K7QXM". */
export function makeRoomCode(length = 5): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Tidies what someone typed: upper case, no spaces or dashes. */
export function normaliseRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
