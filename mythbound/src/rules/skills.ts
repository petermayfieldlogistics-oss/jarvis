// Skill trees: tiers that open as points go in, prerequisites, ranks, and
// resetting. The trees themselves are content (TREES in data/defs).

import { TIER_COST, TIER_POINTS, TREES, type SkillNode, type TreeId } from '../data/defs';
import { pointsEarned, rank, treeFor, type Character } from './character';

/** Skill points one rank of this node costs. */
export const nodeCost = (n: Pick<SkillNode, 'tier'>) => TIER_COST[n.tier] ?? 1;

export function findNode(tree: TreeId, id: string): SkillNode | undefined {
  return TREES[tree].nodes.find((n) => n.id === id);
}

/** Points the hero has put into a tree. */
export function pointsSpent(c: Character, tree: TreeId = treeFor(c)): number {
  let sum = 0;
  for (const n of TREES[tree].nodes) sum += Math.min(rank(c, n.id), n.maxRank) * nodeCost(n);
  return sum;
}

/** Why a node can't take another rank yet (null: nothing stands in the way but points). */
export function lockReason(c: Character, n: SkillNode, tree: TreeId = treeFor(c)): string | null {
  const short = TIER_POINTS[n.tier] - pointsSpent(c, tree);
  if (short > 0) return `Spend ${short} more point${short === 1 ? '' : 's'} in this tree`;
  if (c.level < n.level) return `Reach level ${n.level}`;
  const missing = n.req?.find((id) => rank(c, id) < 1);
  if (missing) return `Learn ${findNode(tree, missing)?.name ?? missing} first`;
  return null;
}

export interface NodeView {
  node: SkillNode;
  rank: number;
  cost: number;
  maxed: boolean;
  /** Another rank can be learned right now. */
  ready: boolean;
  reason: string | null;
}

export function nodeView(c: Character, n: SkillNode, tree: TreeId = treeFor(c)): NodeView {
  const r = rank(c, n.id);
  const cost = nodeCost(n);
  const maxed = r >= n.maxRank;
  const reason = maxed ? null : lockReason(c, n, tree);
  return { node: n, rank: r, cost, maxed, ready: !maxed && !reason && c.skillPoints >= cost, reason };
}

/** Spends points on one rank of a node in the hero's tree. */
export function learnSkill(c: Character, id: string): boolean {
  const tree = treeFor(c);
  const n = findNode(tree, id);
  if (!n || !nodeView(c, n, tree).ready) return false;
  c.skillPoints -= nodeCost(n);
  c.skills[id] = rank(c, id) + 1;
  return true;
}

/** Embers to reset the tree: the first reset is free, then it grows with level. */
export function respecCost(c: Character): number {
  return c.respecs > 0 ? 25 * c.level : 0;
}

/** Unlearns everything and hands back every point earned so far. */
export function respec(c: Character): boolean {
  const cost = respecCost(c);
  if (c.gold < cost) return false;
  c.gold -= cost;
  c.respecs++;
  c.skills = {};
  c.skillPoints = pointsEarned(c.level);
  return true;
}

/** A node's effect at a rank: '+{10}% sword damage.' at rank 3 reads '+30% sword damage.' */
export function rankText(n: Pick<SkillNode, 'per' | 'description'>, r: number): string {
  if (!n.per) return n.description;
  return n.per.replace(/\{(\d+(?:\.\d+)?)\}/g, (_, v: string) => String(Math.round(Number(v) * r * 10) / 10));
}
