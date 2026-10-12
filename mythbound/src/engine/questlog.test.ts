import { describe, expect, it } from 'vitest';
import { NPCS, TRIALS } from '../data/world';
import { nextQuestHint, questLines, trackedId } from './questlog';
import { newWorldState, normalizeSave, type SaveData } from './state';
import { createCharacter } from '../rules/character';

const npc = (id: string) => NPCS.find((n) => n.id === id)!;

describe('quest log', () => {
  it('points a new hero to the first quest giver', () => {
    const s = newWorldState();
    expect(questLines(s, 0, 40)).toEqual([]);
    const hint = nextQuestHint(s)!;
    expect(hint.objective).toBe('Talk to Orrin');
    expect(hint.target).toMatchObject({ x: npc('orrin').x, z: npc('orrin').z });
  });

  it('lists active quests with progress and the nearest place to go', () => {
    const s = newWorldState();
    s.quests.bounty = { state: 'active', progress: 3 };
    s.quests.tomes = { state: 'active', progress: 1 };
    const [bounty, tomes] = questLines(s, 0, 40);
    expect(bounty).toMatchObject({ id: 'bounty', label: 'Bounty: Bandits', progress: 3, goal: 8, ready: false });
    expect(bounty.target).not.toBeNull();
    // Hidden things have no known place.
    expect(tomes.target).toBeNull();
  });

  it('sends the hero back to the giver once the goal is reached', () => {
    const s = newWorldState();
    s.quests.bounty = { state: 'active', progress: 8 };
    const [l] = questLines(s, 0, 40);
    expect(l.ready).toBe(true);
    expect(l.objective).toBe('Return to Quill');
    expect(l.target).toMatchObject({ x: npc('quill').x, z: npc('quill').z });
  });

  it('aims the trials quest at the nearest trial not yet conquered', () => {
    const s = newWorldState();
    s.quests.trials = { state: 'active', progress: 1 };
    const hunt = TRIALS.find((t) => t.id === 'hunt')!;
    expect(questLines(s, hunt.x, hunt.z)[0].target?.name).toBe(hunt.name);
    s.trialsDone.push('hunt');
    expect(questLines(s, hunt.x, hunt.z)[0].target?.name).not.toBe(hunt.name);
  });

  it('follows the tracked quest while it is active, else the first one', () => {
    const s = newWorldState();
    s.quests.fish = { state: 'active', progress: 0 };
    s.quests.dead = { state: 'active', progress: 2 };
    expect(trackedId(s, questLines(s, 0, 0))).toBe('fish');
    s.tracked = 'dead';
    expect(trackedId(s, questLines(s, 0, 0))).toBe('dead');
    s.quests.dead.state = 'done';
    expect(trackedId(s, questLines(s, 0, 0))).toBe('fish');
  });

  it('loads saves from before quest tracking and milestones', () => {
    const c = createCharacter({ name: 'Old', classId: 'mage', subclassId: null, raceId: 'human', roleId: 'historian', expansion: false });
    c.level = 7;
    const old = JSON.parse(JSON.stringify({ character: c, world: newWorldState() })) as SaveData;
    delete (old.world as Partial<SaveData['world']>).tracked;
    delete (old.character as Partial<SaveData['character']>).milestone;
    const save = normalizeSave(old);
    expect(save.world.tracked).toBeNull();
    expect(save.character.milestone).toBe(5);
    expect(save.character.skillPoints).toBe(c.skillPoints + 1);
  });
});
