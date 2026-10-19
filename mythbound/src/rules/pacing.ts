// How long the road is: monsters grow with the region they live in, the
// levels come slower past 10, and the great foes rest less between blows.
// The trials are spread from level 10 (the Hunt) to 50 (Erebus); see data/world.ts.

/** A monster raised `bonus` levels above its kind (to its region's level): this much more health… */
export const foeHpMul = (bonus: number) => 1 + 0.14 * Math.max(0, bonus);
/** …and this much harder a bite. */
export const foeDamageMul = (bonus: number) => 1 + 0.13 * Math.max(0, bonus);

/** The great foes' pause between attacks, scaled (less rest, more pressure). */
export const BOSS_PACE = 0.75;

/** Past level 10 each level asks a little more than the curve alone (5% more per level). */
export const slowerPast10 = (level: number) => (level <= 10 ? 1 : 1 + 0.08 * (level - 10));
