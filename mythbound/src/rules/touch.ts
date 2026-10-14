// Touch controls' feel: the stick's dead zone and reach, and how the camera
// swings in behind a running hero. Pure numbers (the engine reads fingers).

export const STICK = {
  /** Thumb travel (px) ignored as a resting thumb. */
  dead: 7,
  /** Travel for full running speed. */
  full: 40,
  /** Past this the stick slides along under the thumb. */
  drag: 80,
  /** Sprint past this, stop sprinting under `walk` (a gap so it doesn't flicker). */
  sprint: 62,
  walk: 46,
};

/** The move (each axis -1..1, y forward) for a thumb this far from the stick's centre (screen px, y down). */
export function stickMove(dx: number, dy: number): { x: number; y: number } {
  const l = Math.hypot(dx, dy);
  if (l < STICK.dead) return { x: 0, y: 0 };
  const push = Math.min(1, (l - STICK.dead) / (STICK.full - STICK.dead));
  return { x: (dx / l) * push, y: (-dy / l) * push };
}

/** How far the camera turns this frame toward a hero facing `off` radians from it, running at `speed`. */
export function followTurn(off: number, speed: number, dt: number): number {
  // Never round to face a hero running back at the camera.
  if (speed <= 2 || Math.abs(off) >= 2.1) return 0;
  return off * (1 - Math.exp(-1.1 * Math.min(1, speed / 8) * dt));
}
