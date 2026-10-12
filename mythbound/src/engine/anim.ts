// The animation contract between gameplay code (player, monsters, bosses)
// and the model animators (humanoid.ts, creatures.ts). Gameplay code writes
// these fields every frame; animators read them and pose the rig.

export type AttackStyle =
  // Hero and humanoid weapon moves. slash/slash2/slash3 are a three-hit combo.
  | 'slash' | 'slash2' | 'slash3' | 'overhead' | 'thrust' | 'spin' | 'heavy'
  | 'cast' | 'bow' | 'throw' | 'roar'
  // Monster and boss moves.
  | 'bite' | 'claw' | 'sting' | 'sweep' | 'charge' | 'slam' | 'leap' | 'stomp' | 'volley' | 'ring' | 'summon' | 'teleport' | 'strikes' | 'combo'
  // The elder and hunted foes (bosses.ts): their strike runs anim.attack 0..1 straight through.
  | 'breath' | 'gust' | 'flight' | 'strike' | 'tail' | 'dive' | 'wave' | 'whirlpool' | 'trident' | 'geyser' | 'reap' | 'drain' | 'web';

export interface AnimState {
  /** Walk/run cycle phase, radians; advance it by distance travelled. */
  phase: number;
  /** 0..1 how much the legs swing (0 idle, 1 full run). */
  moving: number;
  /** Ground speed in m/s (for walk/run blending). */
  speed: number;
  /** Movement direction relative to facing, length 0..1 (strafing, backpedal): x along the rig's local +X (its left side; armR sits at -X), z forward. */
  moveX: number;
  moveZ: number;
  /** -1 when not attacking, else 0..1 progress through the current move. */
  attack: number;
  attackStyle: AttackStyle;
  /** Bow draw 0..1 while aiming. */
  draw: number;
  blocking: boolean;
  /** -1, or 0..1 progress through a dodge roll. */
  rolling: number;
  airborne: boolean;
  flying: boolean;
  swimming: boolean;
  crouching: boolean;
  /** -1 alive, else seconds since death. */
  dead: number;
  /** Seconds since spawn (for idle motion). */
  t: number;
  /** 0..1, set to 1 on a hard landing; animators decay it. */
  landing: number;
  /** 0..1, set to 1 when hit; animators decay it (flinch). */
  hurt: number;
  /** 0..1 strength of a powered-up state (BloodRage, boss phase 2) for posture and glow. */
  fury: number;
  /** Windup 0..1 before an attack lands, for anticipation poses (bosses use it while telegraphing). */
  windup: number;
}

export const newAnim = (): AnimState => ({
  phase: 0, moving: 0, speed: 0, moveX: 0, moveZ: 0, attack: -1, attackStyle: 'slash', draw: 0, blocking: false, rolling: -1,
  airborne: false, flying: false, swimming: false, crouching: false, dead: -1, t: 0, landing: 0, hurt: 0, fury: 0, windup: 0,
});

export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// Timings shared by a boss's gameplay and its animator, so a co-op guest (who
// only receives anim.attack) poses the same moment the host decided.

/** The Elder Dragon's flight, as fractions of its strike: airborne after `up`, diving from `dive`, landing at `land`. */
export const FLIGHT = { up: 0.12, dive: 0.78, land: 0.86 };

/** How far either side of its aim a breath sweeps (radians). */
export const BREATH_SPAN = 0.55;

/** A breath attack sweeps from one side to the other: the head's turn (radians, +left) at strike progress k. */
export function breathSweep(k: number, span: number): number {
  const u = Math.min(1, Math.max(0, (k - 0.06) / 0.86));
  return span * (1 - 2 * u);
}

/** Strike progress (anim.attack) at which each of these moves lands: the Leviathan's head, the Queen's thrusts... */
export const LANDS: Partial<Record<AttackStyle, number[]>> = {
  bite: [0.35], claw: [0.4], strike: [0.12], tail: [0.32], wave: [0.2], gust: [0.35], reap: [0.4], web: [0.3], trident: [0.22, 0.48, 0.76],
  geyser: [0.2], whirlpool: [0.1], breath: [0.06], drain: [0.1], dive: [0.45], flight: [FLIGHT.land],
};
