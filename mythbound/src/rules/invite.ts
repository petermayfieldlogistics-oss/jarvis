// Co-op invite links: the host shares the game's address with `?join=CODE`,
// and a friend who opens it signs in, picks a hero and lands in that room.

/** The room code an invite link carries (`?join=ABCDE`), cleaned up, or null if there isn't a usable one. */
export function inviteCode(search: string): string | null {
  const raw = new URLSearchParams(search).get('join');
  if (!raw) return null;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length >= 4 && code.length <= 8 ? code : null;
}

/** The link that invites a friend into `room`, built on the game's address `base` (its own query and hash dropped). */
export function inviteLink(base: string, room: string): string {
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set('join', room);
  return url.toString();
}
