// The animation contract between gameplay code (player, monsters, bosses)
// and the model animators (humanoid.ts, creatures.ts). Gameplay code writes
// these fields every frame; animators read them and pose the rig.

export type AttackStyle =
  // Hero and humanoid weapon moves. slash/slash2/slash3 are a three-hit combo.
  | 'slash' | 'slash2' | 'slash3' | 'overhead' | 'thrust' | 'spin' | 'heavy'
  | 'cast' | 'bow' | 'throw' | 'roar'
  // Monster and boss moves.
  | 'bite' | 'claw' | 'sting' | 'sweep' | 'charge' | 'slam' | 'leap' | 'stomp' | 'volley' | 'ring' | 'summon' | 'teleport' | 'strikes' | 'combo';

export interface AnimState {
  /** Walk/run cycle phase, radians; advance it by distance travelled. */
  phase: number;
  /** 0..1 how much the legs swing (0 idle, 1 full run). */
  moving: number;
  /** Ground speed in m/s (for walk/run blending). */
  speed: number;
  /** Movement direction relative to facing: x right, z forward, length 0..1 (strafing, backpedal). */
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
