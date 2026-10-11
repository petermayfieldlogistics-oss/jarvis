import type * as THREE from 'three';
import type { RoleId } from '../data/defs';

/**
 * Someone the monsters hunt: the hero at this keyboard or, in co-op, a friend.
 * Monsters choose among heroes; damage to a friend is sent to their game.
 */
export interface Hero {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  alive: boolean;
  radius: number;
  crouching: boolean;
  readonly roleId: RoleId;
  center(out?: THREE.Vector3): THREE.Vector3;
  /** How noticeable the hero is (0 = invisible). */
  stealthFactor(): number;
}
