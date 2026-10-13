// Conversations and everything the hero can interact with.

import { ANCIENT_GLYPH, CLASSES, RACES, RELICS, ROLES, RUNES, SPELLS, WEAPONS, type ClassId, type RaceId, type RuneId, type ShopId, type SpellId } from '../data/defs';
import { BOSSES, ELDER_TRIALS, ITEMS, LAIRS, LORE, PAGES, plotCentre, QUESTS, SHRINES, TOMES, TRIALS, WEAPON_TRIALS, type QuestId } from '../data/world';
import { isRelic, rewardName } from './bosses';
import { canLearnSpell, dracoFlightHours, learnSpell, lightHealMultiplier, MAX_WEAPON_LEVEL, shopPrice, upgradeCost, type Character } from '../rules/character';
import { canWield, isLightSealed } from '../rules/combat';
import { MAX_KNIVES, buyRune, buyWeapon, canBearRune, inscribe, ownsKnives, refillKnives, runesHeld, shopStock } from '../rules/weapons';
import type { DialogOption, DialogSpec } from '../ui/dialog';
import type { Game } from './game';
import * as THREE from 'three';
import type { Interactable } from './world';
import { CROP_IDS, CROPS, SEED_PACK, seedItem, type CropId } from '../data/goods';
import { FARM, buySeeds, digUp, feed, harvest, isWet, plant, progress, rentPlot, rentPrice, ripeIn, sellCrop, stageOf, water } from '../rules/farming';
import { hours } from './farm';

/** What the chronicler mutters on meeting the newer races. */
const CHRONICLER_ASIDE: Partial<Record<RaceId, string>> = {
  zombie: ' A zombie. Could you, umm, not drip on the pages?',
  angelic: ' An angel? The glow is lovely. Very good for reading.',
  orc: ' An orc! Please mind the ink. And the desk. And me.',
};

/** What the Chronicler mutters about the newer classes. */
const CHRONICLER_CLASS: Partial<Record<ClassId, string>> = {
  monk: ' A monk. Do you really sit still for hours? I tried once. I fell asleep on the inkpot.',
  sorcerer: ' A sorcerer. Please point that wand somewhere else while I write.',
  rogue: " A rogue. Good. Nobody will believe I met you, and I won't be writing much down.",
};

/** Orrin's welcome, by class (and by path, for the newer ones). */
function orrinWelcome(c: Character): string {
  const tail = 'The scrolls speak of six weapons of the old gods, sealed in six trials across the land. Whoever claims them must be worthy, or the weapons will not answer.';
  switch (c.subclassId) {
    case 'darkmage':
      return `A Dark Mage. I can smell the candle smoke and grave dirt on you. Mind what you bargain for. ${tail}`;
    case 'lightmage':
      return `A Light Mage! Sister Lumen will be glad of you; the dead are restless of late. ${tail}`;
  }
  switch (c.classId) {
    case 'monk':
      return `Welcome, monk. No blade, I see. The old gods care less for steel than you might think. ${tail}`;
    case 'rogue':
      return `A rogue, is it? Keep your hands where I can see them, and off my scrolls. ${tail}`;
  }
  return `Welcome, ${CLASSES[c.classId].name.toLowerCase()}. ${tail}`;
}

/** Why a tome's spell will not take. */
const TOME_REFUSAL: Partial<Record<ClassId, string>> = {
  ranger: 'Rangers are limited to sky magic.',
  monk: "A monk's arts are of breath and body, not of tomes.",
  rogue: 'Rogues learn tricks, not spells.',
  sorcerer: 'A sorcerer learns only arcane tomes, and the magic of their own path.',
};

export class Story {
  /** Scratch spot for effects. */
  private tmp = new THREE.Vector3();
  constructor(private g: Game) {}

  private get c() {
    return this.g.player.c;
  }

  open(spec: DialogSpec) {
    this.g.setMode('dialog');
    this.g.dialog.open(spec, () => {
      if (this.g.mode === 'dialog') this.g.setMode('play');
    });
  }

  /**
   * The Chronicler's voice. If the hero is an Assassin, someone has been at
   * the manuscript with a knife.
   */
  chronicle(text: string): string {
    if (this.c.roleId !== 'assassin') return text;
    return text.replace(/\b(assassins?|guild|shadows?|daggers?)\b/gi, '█████') + '\n\n<i>[This page has been edited. — A.]</i>';
  }

  label(it: Interactable): string {
    if (it.kind === 'trial') {
      const t = TRIALS.find((x) => `trial-${x.id}` === it.id)!;
      return this.g.state.trialsDone.includes(t.id) ? `${t.name} (conquered)` : it.label;
    }
    if (it.kind === 'lore') {
      const l = LORE.find((x) => `lore-${x.id}` === it.id)!;
      return l.ancient && this.c.roleId !== 'historian' ? 'Read: ancient carving' : it.label;
    }
    return it.label;
  }

  interact(it: Interactable) {
    const g = this.g;
    switch (it.kind) {
      case 'npc':
        return this.talk(it.id.slice(4));
      case 'shrine':
        return this.shrine(it.id.slice(7));
      case 'lore':
        return this.lore(it.id.slice(5));
      case 'tome':
        return this.tome(it);
      case 'page':
        return this.page(it);
      case 'anvil':
        return this.forge(false);
      case 'dock':
        if (this.c.roleId === 'sailor' && it.object) {
          g.player.board(g, it.object);
          return;
        }
        return this.open({
          title: 'A small boat',
          text: 'Ropes, sails, knots. Only a Sailor knows how to make it go anywhere but down.\n\nYou could swim… if you are brave, and your stamina holds.',
          options: [{ label: 'Leave it' }],
        });
      case 'fish':
        return this.fish();
      case 'ore':
        return this.mine(it);
      case 'trial':
        return this.trial(it.id.slice(6));
      case 'loot':
        if (it.id === 'embers') return this.recoverEmbers();
        return this.legendary(it.id.slice(10));
      case 'plot':
        return this.plot(Number(it.id.slice(5)));
    }
  }

  // -------------------------------------------------------------- townsfolk --

  private quest(id: QuestId) {
    return this.g.state.quests[id];
  }

  private reward(id: QuestId): string {
    const q = QUESTS[id];
    const c = this.c;
    const st = this.quest(id);
    st.state = 'done';
    const parts: string[] = [];
    if (q.reward.gold) {
      c.gold += q.reward.gold;
      parts.push(`${q.reward.gold} embers`);
    }
    if (q.reward.flask) {
      c.flasksMax++;
      c.flasks = c.flasksMax;
      parts.push('+1 flask');
    }
    if (q.reward.item) {
      c.items[q.reward.item] = (c.items[q.reward.item] ?? 0) + 1;
      parts.push(ITEMS[q.reward.item].name);
    }
    if (q.reward.xp) {
      this.g.gainXp(q.reward.xp);
      parts.push(`${q.reward.xp} XP`);
    }
    this.g.audio.play('pickup');
    this.g.hud.toast(`Quest complete: ${q.name}`, 'quest');
    this.g.save();
    return parts.join(', ');
  }

  private accept(id: QuestId) {
    const st = this.quest(id);
    st.state = 'active';
    if (id === 'ore') st.progress = Math.min(QUESTS.ore.goal, this.c.items['ember-ore'] ?? 0);
    if (id === 'pages') st.progress = PAGES.filter((p) => this.g.state.taken.includes(p.id)).length;
    if (id === 'tomes') st.progress = TOMES.filter((t) => this.g.state.taken.includes(`tome-${t.spell}`)).length;
    if (id === 'trials') st.progress = this.trialsWon(false);
    if (id === 'elders') st.progress = this.trialsWon(true);
    if (id === 'hunts') st.progress = LAIRS.filter((l) => this.g.state.flags[`hunted-${l.boss}`]).length;
    // The quest bar follows the newest quest.
    this.g.state.tracked = id;
    this.g.hud.toast(`New quest: ${QUESTS[id].name}`, 'quest');
  }

  /** Weapon trials (or elder foes) conquered. */
  private trialsWon(elder: boolean) {
    return (elder ? ELDER_TRIALS : WEAPON_TRIALS).filter((t) => this.g.state.trialsDone.includes(t.id)).length;
  }

  /** A quest offered with a few words first (the elder foes, the monster hunts). */
  private tellOf(id: QuestId, ask: string, title: string, text: string, done: string, progress: string, back: string): DialogOption | null {
    if (this.quest(id).state !== 'none') return this.questOption(id, ask, done, progress);
    return {
      label: ask,
      action: () =>
        this.open({
          title,
          text,
          options: [{ label: 'I will hunt them.', action: () => this.accept(id) }, { label: 'Not yet.', action: () => this.talk(back) }],
        }),
    };
  }

  private questOption(id: QuestId, offer: string, done: string, progressText: string): DialogOption | null {
    const st = this.quest(id);
    if (st.state === 'none') return { label: `${offer}`, action: () => this.accept(id) };
    if (st.state === 'active' && st.progress >= QUESTS[id].goal) {
      return {
        label: `[${QUESTS[id].name}] ${done}`,
        action: () => {
          if (id === 'ore') this.c.items['ember-ore'] = Math.max(0, (this.c.items['ember-ore'] ?? 0) - QUESTS.ore.goal);
          if (id === 'fish') this.c.items.fish = Math.max(0, (this.c.items.fish ?? 0) - QUESTS.fish.goal);
          const got = this.reward(id);
          this.open({ title: 'Reward', text: `You receive: ${got}.`, options: [{ label: 'Thanks' }] });
        },
      };
    }
    if (st.state === 'active') return { label: `[${QUESTS[id].name}] ${progressText} (${st.progress}/${QUESTS[id].goal})`, disabled: true };
    return null;
  }

  talk(id: string): void {
    const c = this.c;
    const g = this.g;
    const opts = (list: (DialogOption | null)[]) => [...(list.filter(Boolean) as DialogOption[]), { label: 'Farewell' }];
    switch (id) {
      case 'orrin': {
        if (this.quest('trials').state === 'active') this.quest('trials').progress = this.trialsWon(false);
        if (this.quest('elders').state === 'active') this.quest('elders').progress = this.trialsWon(true);
        const historian = c.roleId === 'historian';
        return this.open({
          title: 'Orrin',
          subtitle: 'Keeper of the Archive',
          text: historian
            ? `Ah, a fellow Historian. Then you already know more than you should, ${c.name}. Good. Six weapons of the old gods sleep in six trials. The scrolls even say who may hold them.`
            : orrinWelcome(c),
          options: opts([
            this.questOption('trials', 'Tell me about the trials.', 'I have conquered them all.', 'The trials'),
            this.questOption('tomes', 'Are there more spells to find?', 'I found the lost tomes.', 'Spell tomes'),
            this.tellOf(
              'elders',
              'Is there anything greater than the trials?',
              'The Elder Foes',
              `Older than the gods' weapons are three beasts the scrolls call the Elder Foes, and each guards a relic of great power.\n\n• The Leviathan coils around the Serpent's Shoal, east along the coast. ${RELICS['leviathan-pearl'].name}: ${RELICS['leviathan-pearl'].boon}\n• The Queen of the Sea holds her Drowned Court on the headland west of the docks. ${RELICS['tide-crown'].name}: ${RELICS['tide-crown'].boon}\n• Beyond Molten Peak, on the mountain's northern shoulder, the Elder Dragon roosts. ${RELICS['dragon-heart'].name}: ${RELICS['dragon-heart'].boon}\n\nNo boat is needed: the shoal and the court are joined to the beach. But be strong, level 11 at least. They are on your map.`,
              'The elder foes are slain.',
              'Elder foes',
              'orrin',
            ),
            {
              label: 'Where are the trials?',
              action: () =>
                this.open({
                  title: 'The Six Trials',
                  text: WEAPON_TRIALS.map((t) => {
                    const done = g.state.trialsDone.includes(t.id) ? ' ✔' : '';
                    return `• ${t.name}${done}: ${BOSSES[t.boss].name}, ${BOSSES[t.boss].title}. Recommended level ${t.level}. Guards the ${WEAPONS[BOSSES[t.boss].reward].name}.`;
                  }).join('\n'),
                  options: [{ label: 'Back', action: () => this.talk('orrin') }],
                }),
            },
            {
              label: 'Who may wield the weapons?',
              action: () =>
                this.open({
                  title: 'Worthiness',
                  text: [
                    'Sword of Mars: Warriors. Their fury stacks with every blow.',
                    'Bow of Artemis: Rangers. An Elf ranger unlocks its full power.',
                    'Master Bolt: anyone may hurl it, but only a Ranger uses it properly.',
                    'Staff of Hecate: Mages alone.',
                    'Hammer of Hephaestus: Blacksmiths alone.',
                    "Poseidon's Trident: Sailors alone.",
                    '',
                    'And the newer paths keep to their own arms: Monks fight with hand wraps, quarterstaffs and spears; Sorcerers with wands, rune circles, staves and daggers; Rogues with daggers, throwing knives, swords and bows.',
                  ].join('\n'),
                  options: [{ label: 'Back', action: () => this.talk('orrin') }],
                }),
            },
            historian
              ? {
                  label: `What do you know of ${ANCIENT_GLYPH}?`,
                  action: () =>
                    this.open({
                      title: ANCIENT_GLYPH,
                      text: 'A race so old its language has been lost to time. We assume they were humanoid. Thunder, a broken heart, little lizards like dragons, a giant holding the world… and eyes. Do not go looking for the eyes, friend.',
                      options: [{ label: 'Back', action: () => this.talk('orrin') }],
                    }),
                }
              : null,
          ]),
        });
      }
      case 'brann': {
        const smith = c.roleId === 'blacksmith';
        return this.open({
          title: 'Brann',
          subtitle: 'Smith',
          text: (smith
            ? "Another smith! Use my anvil whenever you like, half the usual cost. Some say a smith can even wield the Hammer of Hephaestus."
            : "Need an edge? I can improve your weapons, for embers and Ember Ore. A blacksmith would do it for half, mind.") +
            (c.raceId === 'orc' ? "\n\nAn orc, eh? Mind the doorframe. Your lot never bring a blade back with an edge left on it… good for business." : '') +
            (c.classId === 'monk' ? "\n\nNo blade? Fists, then. I can sew iron into your wraps (tiger claws, if you've the embers), and a good ironwood staff never hurt anyone. Anyone friendly." : '') +
            (c.classId === 'rogue' ? "\n\nDaggers, eh? I keep a fine edge on those. And a duelist's saber, light as a feather. Don't tell me what it's for." : ''),
          options: opts([
            { label: 'Upgrade my weapons', action: () => this.forge(true) },
            { label: 'Show me your steel (buy weapons and runes)', action: () => this.shop('brann') },
            this.questOption('ore', 'Need anything?', 'Here is your Ember Ore.', 'Ember Ore'),
          ]),
        });
      }
      case 'lumen': {
        const sealed = isLightSealed(c, g.gameMinutes);
        const knight = c.roleId === 'knight';
        return this.open({
          title: 'Sister Lumen',
          subtitle: 'Chapel of Light',
          text: c.devilDeals >= 4
            ? 'Oh, child. I can see it on you. The Devil holds your light now, and it will not be given back.'
            : sealed
              ? `You have made a deal with the Devil (${c.devilDeals} so far). Your light is sealed for now. Every deal seals it longer, and the fourth seals it forever. Please… be careful.`
              : knight
                ? 'A Knight of the Light! The chapel is yours. May your light never be sealed.'
                : c.subclassId === 'lightmage'
                  ? 'A Light Mage! Your wards and your mending… the chapel has prayed for hands like yours. Smite the restless dead for me, child.'
                  : c.subclassId === 'darkmage'
                    ? 'I can see shadow clinging to you, child. Hexes and hunger… be careful the dark does not drink you too. The light will still mend you here.'
                : c.raceId === 'angelic'
                  ? 'Oh! Wings, and a halo… the old books spoke of your kind. Stay close to your friends, child, and your light will mend them.'
                  : c.raceId === 'zombie'
                    ? 'Oh! Oh my. You are… not quite alive, are you? The light still welcomes you, child. It just has to work a little harder.'
                    : 'Be welcome in the light. If you hear of the Deal with the Devil: every deal seals your light magic longer. The fourth, forever.',
          options: opts([
            { label: 'Pray (restore health)', action: () => {
              // The light mends the dead less well.
              g.player.heal((g.player.maxHp - g.player.hp) * lightHealMultiplier(c));
              g.fx.pillar(g.player.pos.clone(), 0xfff0b0, 1.5);
              g.hud.toast(lightHealMultiplier(c) < 1 ? 'The light mends you… a little. It stings.' : 'The light restores you.');
            } },
            this.questOption('dead', 'Can I help the chapel?', 'The restless dead are at peace.', 'Restless dead'),
          ]),
        });
      }
      case 'quill': {
        const flaskCost = 150 * c.flasksMax;
        return this.open({
          title: 'Quill',
          subtitle: 'Merchant',
          text: c.classId === 'rogue'
            ? `Hands where I can see them, friend. Both of them. Good. Embers for goods, goods for embers. You have ${c.gold} embers… for now.`
            : c.raceId === 'zombie'
            ? `Phew! What is that smell? Oh. It's you. Fine, I'll trade with the dead, but the dead pay extra. You have ${c.gold} embers.`
            : c.raceId === 'orc'
              ? `Embers for goods, goods for embers. And please, don't lean on the shelves. You have ${c.gold} embers.`
              : `Embers for goods, goods for embers. You have ${c.gold} embers.`,
          options: opts([
            { label: 'Any curios? (wands, runes, instruments)', action: () => this.shop('quill') },
            this.buy('20 arrows', 30, () => (c.arrows.wood += 20)),
            this.buy('2 fish', 25, () => (c.items.fish = (c.items.fish ?? 0) + 2)),
            c.flasksMax < 6 ? this.buy(`Flask upgrade (+1 flask, now ${c.flasksMax})`, flaskCost, () => (c.flasksMax++, (c.flasks = c.flasksMax))) : null,
            (c.items['ember-ore'] ?? 0) > 0 && this.quest('ore').state !== 'active'
              ? { label: 'Sell 1 Ember Ore (40)', action: () => ((c.items['ember-ore']! -= 1), (c.gold += 40), this.talk('quill')) }
              : null,
            this.questOption('bounty', 'Any work?', 'The roads are safer.', 'Bandit bounty'),
            this.tellOf(
              'hunts',
              'Any bounties on monsters?',
              'Monster Hunts',
              "Two bounties nobody will touch. Broodmother, a spider as big as a cart, nests in Silken Hollow deep in Whisperwood. She drops on folk from the trees: look up. And the Reaper walks Mourner's Rest in the Weeping Mire, but only after dark. Whatever they carry is yours to keep. I've marked both on your map.",
              'Both beasts are dead.',
              'Monster hunts',
              'quill',
            ),
          ]),
        });
      }
      case 'mara': {
        const sailor = c.roleId === 'sailor';
        return this.open({
          title: 'Mara',
          subtitle: 'Fisher',
          text: sailor
            ? "A sailor! Take a boat from any dock, they're yours as much as mine. The island to the south hides the Trial of Tides. And they say Poseidon's Trident answers only to sailors. Keep clear of the shoal to the east, though: something huge coils there, and a song comes off the western point at dusk."
            : "The fish bite along the shore. Stand by the water and cast a line. The island out there? You would need a boat, or strong arms. And don't go near the shoal to the east. My nets came back bitten through, and the bite was wider than my boat.",
          options: opts([this.questOption('fish', 'Need a hand?', 'Here are your fish.', 'A good catch')]),
        });
      }
      case 'chronicler': {
        const pages = PAGES.filter((p) => g.state.taken.includes(p.id)).length;
        const st = this.quest('pages');
        if (st.state === 'active') st.progress = pages;
        return this.open({
          title: 'The Chronicler',
          subtitle: 'Paid Not to Ask',
          text: this.chronicle(
            g.state.flags.eyesSeen
              ? 'You… you looked at them, didn’t you? Umm. So I was paid to not ask questions, and just write. Sooo I’m just gonna ignore that.'
              : `Oh! A hero. ${RACES[c.raceId].name}, ${CLASSES[c.classId].name}, ${ROLES[c.roleId].name}… let me write that down.${CHRONICLER_ASIDE[c.raceId] ?? ''}${CHRONICLER_CLASS[c.classId] ?? ''} Seriously, who comes up with these things? I lost some pages of an old manuscript. The wind took them. I'm sure it was the wind.`,
          ),
          options: opts([
            this.questOption('pages', 'I can look for your pages.', 'I found your pages.', 'Missing pages'),
            st.state === 'done' && !g.state.flags.eyesRevealed
              ? { label: 'Where were the pages pointing?', action: () => this.revealRuins() }
              : null,
            {
              label: 'What do you write about?',
              action: () =>
                this.open({
                  title: 'The Chronicler',
                  text: this.chronicle(
                    'Classes, races, roles. The Dark Slayer? Uhh, well, no one has survived to see them and tell anyone. And the Assassins… I tried to write about the Assassins once. Someone edited it. With a knife.',
                  ),
                  options: [{ label: 'Back', action: () => this.talk('chronicler') }],
                }),
            },
          ]),
        });
      }
      case 'wren': {
        // A first visit comes with a handful of carrot seeds.
        const flags = g.state.flags;
        let gift = '';
        if (!flags.wrenSeeds) {
          flags.wrenSeeds = true;
          c.items[seedItem('carrot')] = (c.items[seedItem('carrot')] ?? 0) + SEED_PACK;
          gift = `\n\nHere: ${SEED_PACK} carrot seeds to start you off.`;
          g.hud.toast(`+${SEED_PACK} carrot seeds`, 'quest');
        }
        const farm = g.state.farm;
        const rent = rentPrice(c, farm);
        const selling = CROP_IDS.some((id) => (c.items[id] ?? 0) > 0);
        return this.open({
          title: 'Wren',
          subtitle: 'Farmer',
          text: (c.raceId === 'zombie'
            ? 'Mind the carrots. They’re not for you. Well, they are, if you pay. Seed costs a bit more for your sort. Folk say you bring the blight.'
            : c.classId === 'monk'
              ? 'A monk! Then you know patience. Sow, water, wait. The beds by the fence are yours to use.'
              : 'Hearthhold eats what this field grows. Three beds are yours to use; I rent out the rest. Plant a seed, water it, and come back when it’s ripe.') + gift,
          options: opts([
            { label: 'Buy seeds', action: () => this.seedShop() },
            selling ? { label: 'Sell my harvest', action: () => this.sellHarvest() } : null,
            rent !== null
              ? { label: `Rent another bed (${rent}) · you have ${farm.owned} of ${FARM.plots}`, disabled: c.gold < rent, action: () => (this.rentBed(), this.talk('wren')) }
              : null,
            this.questOption('harvest', 'Any work in the field?', 'The harvest is in.', 'Bring in harvests'),
            {
              label: 'How do crops grow?',
              action: () =>
                this.open({
                  title: 'Wren',
                  text: `Plant a seed in a bed you own, then water it: watered soil grows a crop at full speed for about ${FARM.waterLasts / 60} hours, dry soil at half speed. Nothing withers, so take your time. A fish in the soil before a crop is half grown brings in one more (a golden fish, two). Crops grow while you're out adventuring, not while you sleep.`,
                  options: [{ label: 'Back', action: () => this.talk('wren') }],
                }),
            },
          ]),
        });
      }
    }
  }

  // ------------------------------------------------------------------ field --

  private seedShop() {
    const c = this.c;
    this.open({
      title: 'Wren',
      subtitle: 'Seeds',
      text: `Seeds come ${SEED_PACK} to a pack. You have ${c.gold} embers.`,
      options: [
        ...CROP_IDS.map((id): DialogOption => {
          const crop = CROPS[id];
          const cost = shopPrice(c, crop.seedPrice);
          const have = c.items[seedItem(id)] ?? 0;
          return {
            label: `${crop.name} seeds ×${SEED_PACK} (${cost}) · ripe in ${hours(crop.grow)} · ${crop.use}${have ? ` · have ${have}` : ''}`,
            disabled: c.gold < cost,
            action: () => {
              if (!buySeeds(c, id)) this.g.audio.play('pickup');
              this.seedShop();
            },
          };
        }),
        { label: 'Back', action: () => this.talk('wren') },
      ],
    });
  }

  private sellHarvest() {
    const c = this.c;
    const list = CROP_IDS.filter((id) => (c.items[id] ?? 0) > 0);
    if (!list.length) return this.talk('wren');
    this.open({
      title: 'Wren',
      subtitle: 'Buying crops',
      text: 'I’ll take what you don’t eat.',
      options: [
        ...list.map((id): DialogOption => {
          const n = c.items[id] ?? 0;
          return {
            label: `Sell ${n} ${n === 1 ? CROPS[id].name.toLowerCase() : CROPS[id].plural} (${n * CROPS[id].sell})`,
            action: () => {
              sellCrop(c, id);
              this.g.audio.play('pickup');
              this.sellHarvest();
            },
          };
        }),
        { label: 'Back', action: () => this.talk('wren') },
      ],
    });
  }

  private rentBed() {
    const err = rentPlot(this.c, this.g.state.farm);
    if (err) return this.g.hud.toast(err, 'warn');
    this.g.audio.play('pickup');
    this.g.hud.toast(`Another seed bed is yours (${this.g.state.farm.owned} of ${FARM.plots}).`, 'quest');
    this.g.farm.refresh(this.g);
  }

  /** A seed bed: rent it, sow it, water it, see how it does, or bring in the harvest. */
  private plot(i: number) {
    const g = this.g;
    const c = this.c;
    const farm = g.state.farm;
    if (!(i >= 0 && i < FARM.plots)) return;
    const p = farm.plots[i];
    const done = () => g.farm.refresh(g);
    if (i >= farm.owned) {
      const price = rentPrice(c, farm);
      return this.open({
        title: 'Overgrown bed',
        text: price === null ? 'Weeds.' : `Wren rents this bed out for ${price} embers. You have ${c.gold}.`,
        options: [
          price !== null && i === farm.owned ? { label: `Rent it (${price})`, disabled: c.gold < price, action: () => this.rentBed() } : null,
          { label: 'Leave it' },
        ].filter(Boolean) as DialogOption[],
      });
    }
    if (!p) {
      const seeds = CROP_IDS.filter((id) => (c.items[seedItem(id)] ?? 0) > 0);
      const empty: number[] = [];
      for (let k = 0; k < farm.owned; k++) if (!farm.plots[k]) empty.push(k);
      return this.open({
        title: 'Seed bed',
        text: seeds.length ? 'What will you plant?' : 'You have no seeds. Wren sells them, by the gate.',
        options: [
          ...seeds.map((id): DialogOption => ({
            label: `Plant ${CROPS[id].name.toLowerCase()} (${c.items[seedItem(id)]} seeds) · ripe in ${hours(CROPS[id].grow)}`,
            action: () => this.sow([i], id),
          })),
          ...(empty.length > 1
            ? seeds.map((id): DialogOption => ({
                label: `Plant ${CROPS[id].plural} in every empty bed (${Math.min(empty.length, c.items[seedItem(id)] ?? 0)})`,
                action: () => this.sow(empty, id),
              }))
            : []),
          { label: 'Leave it' },
        ],
      });
    }
    const crop = CROPS[p.crop];
    const stage = stageOf(p, farm.clock);
    // One tap does the whole row (this bed and the others beside it that need the same).
    const row = [i - (i % 3), i - (i % 3) + 1, i - (i % 3) + 2].filter((k) => k < farm.owned);
    if (stage === 4) {
      const got: Partial<Record<CropId, number>> = {};
      let beds = 0;
      for (const k of [i, ...row.filter((k) => k !== i)]) {
        const r = harvest(c, farm, k, Math.random());
        if (!r) continue;
        got[r.crop] = (got[r.crop] ?? 0) + r.n;
        beds++;
        const at = plotCentre(k);
        g.fx.emit(this.tmp.set(at.x, g.player.pos.y + 0.6, at.z), { color: CROPS[r.crop].fruit, count: 14, speed: 3, life: 0.6, size: 0.35, up: 2 });
      }
      const text = (Object.entries(got) as [CropId, number][]).map(([id, n]) => `+${n} ${n === 1 ? CROPS[id].name.toLowerCase() : CROPS[id].plural}`).join(', ');
      g.hud.toast(text, 'quest');
      g.fx.damageNumber(g.player.center().setY(g.player.pos.y + 2.2), text, 'heal');
      g.audio.play('pickup');
      if (this.quest('harvest').state === 'active') g.questProgress('harvest', beds);
      return done();
    }
    if (!isWet(p, farm.clock)) {
      let beds = 0;
      for (const k of [i, ...row.filter((k) => k !== i)]) {
        const q = farm.plots[k];
        if (!q || isWet(q, farm.clock) || !water(farm, k)) continue;
        beds++;
        const at = plotCentre(k);
        g.fx.emit(this.tmp.set(at.x, g.player.pos.y + 1.2, at.z), { color: 0x6ab8ff, count: 14, speed: 1.5, life: 0.6, size: 0.25, up: -2 });
      }
      g.hud.toast(`Watered ${beds === 1 ? 'the bed' : `${beds} beds`}: full speed for ${hours(FARM.waterLasts)}.`);
      g.audio.play('drink');
      return done();
    }
    const pct = Math.round(progress(p, farm.clock) * 100);
    const canFeed = !p.fed && progress(p, farm.clock) < FARM.feedBefore;
    this.open({
      title: crop.name,
      subtitle: `${pct}% grown`,
      text: `Ripe in about ${hours(ripeIn(p, farm.clock))} if the soil stays wet; it stays wet for another ${hours(p.wetUntil - farm.clock)}.${p.fed ? ' Fed: it will bring in more.' : ''}`,
      options: [
        canFeed && (c.items.fish ?? 0) > 0 ? { label: `Feed it a fish (+1 crop) · have ${c.items.fish}`, action: () => this.feedBed(i, 'fish') } : null,
        canFeed && (c.items['golden-fish'] ?? 0) > 0 ? { label: `Feed it a golden fish (+2 crops) · have ${c.items['golden-fish']}`, action: () => this.feedBed(i, 'golden-fish') } : null,
        {
          label: 'Pull it up (the crop is lost)',
          action: () =>
            this.open({
              title: crop.name,
              text: `Pull up the ${crop.plural}? The seed is lost.`,
              options: [{ label: 'Pull it up', action: () => (digUp(farm, i), done()) }, { label: 'Keep it' }],
            }),
        },
        { label: 'Leave it' },
      ].filter(Boolean) as DialogOption[],
    });
  }

  private sow(beds: number[], crop: CropId) {
    const g = this.g;
    let n = 0;
    for (const i of beds) if (!plant(this.c, g.state.farm, i, crop)) n++;
    if (!n) return;
    g.hud.toast(`Planted ${n} ${n === 1 ? 'bed' : 'beds'} of ${CROPS[crop].plural}. Water ${n === 1 ? 'it' : 'them'}!`);
    g.audio.play('pickup');
    g.fx.dust(g.player.pos.clone().setY(g.player.pos.y + 0.1), 10, 0x7a5a3a);
    g.farm.refresh(g);
  }

  private feedBed(i: number, item: string) {
    const err = feed(this.c, this.g.state.farm, i, item);
    if (err) return this.g.hud.toast(err, 'warn');
    this.g.hud.toast('The soil drinks it in. More at harvest.');
    this.g.audio.play('pickup');
  }

  private buy(label: string, base: number, give: () => void): DialogOption {
    const c = this.c;
    const cost = shopPrice(c, base);
    return {
      label: `Buy ${label} (${cost})`,
      disabled: c.gold < cost,
      action: () => {
        c.gold -= cost;
        give();
        this.g.audio.play('pickup');
        this.talk('quill');
      },
    };
  }

  private revealRuins() {
    this.g.state.flags.eyesRevealed = true;
    this.open({
      title: 'The Chronicler',
      text: this.chronicle(
        'The pages… they all describe the same place. Far to the south-west, in the Weeping Mire, there is a ring of stones carved with eyes. I marked it on your map. Please don’t go. And if you go, don’t look.',
      ),
      options: [{ label: 'I will look.' }, { label: 'I will not look.' }],
    });
  }

  // ------------------------------------------------------------------ places --

  shrine(id: string) {
    const g = this.g;
    const s = SHRINES.find((x) => x.id === id)!;
    const p = g.player;
    const first = !g.state.shrinesFound.includes(id);
    if (first) g.state.shrinesFound.push(id);
    g.state.lastShrine = id;
    p.hp = p.maxHp;
    p.mana = p.maxMana;
    p.refillStamina();
    p.c.flasks = p.c.flasksMax;
    if (p.c.raceId === 'zombie' && p.c.riseSpent) g.hud.toast('Rested, the grave lets go of you again: Not Dead Yet is ready.', 'skill');
    p.c.riseSpent = false;
    refillKnives(p.c);
    if (p.soulOrPower) {
      p.soulOrPower = false;
      g.hud.toast('Your soul is your own again. What you lost stays lost.');
    }
    p.flightLeft = dracoFlightHours(p.c) * 60;
    g.spawnAll();
    g.save();
    g.audio.play('holy');
    const night = g.isNight;
    this.open({
      title: s.name,
      subtitle: first ? 'Shrine discovered' : 'You rest by the flame',
      text: `Health, mana and flasks restored. The world stirs again.${p.c.skillPoints > 0 ? `\n\nYou have ${p.c.skillPoints} unspent skill point${p.c.skillPoints > 1 ? 's' : ''}.` : ''}`,
      options: [
        { label: night ? 'Pass time until morning' : 'Pass time until nightfall', action: () => (g.passTime(night ? 7 * 60 : 20 * 60), g.hud.toast(night ? 'Dawn breaks.' : 'Night falls.')) },
        { label: 'Skills', action: () => g.menu.open('skills') },
        { label: 'Travel to another shrine', action: () => g.menu.open('map') },
        { label: 'Leave' },
      ],
    });
  }

  private lore(id: string) {
    const l = LORE.find((x) => x.id === id)!;
    const g = this.g;
    const readable = !l.ancient || this.c.roleId === 'historian';
    if (readable && !g.state.loreRead.includes(id)) {
      g.state.loreRead.push(id);
      g.gainXp(this.c.roleId === 'historian' ? 60 : 30);
    }
    this.open({
      title: readable ? l.title : 'An ancient carving',
      text: readable
        ? this.chronicle(l.text)
        : `⟟⏃⋏⍜ ${ANCIENT_GLYPH} ⟒⊬⟒⌇ ⏁⊑⎍⋏⎅⟒⍀ ⏚⍀⍜☍⟒⋏ ⊑⟒⏃⍀⏁ ⟟ ⌇⏃⍙\n\nYou cannot read this. A Historian could.`,
      glitch: !readable,
      options: [{ label: 'Close' }],
    });
  }

  private tome(it: Interactable) {
    const g = this.g;
    const spell = it.id.slice(5) as SpellId;
    const def = SPELLS[spell];
    it.used = true;
    if (it.object) it.object.visible = false;
    g.state.taken.push(it.id);
    g.questProgress('tomes', 1);
    const can = canLearnSpell(this.c, spell);
    if (can) learnSpell(this.c, spell);
    g.updateTouchButtons();
    g.audio.play('pickup');
    this.open({
      title: def.name,
      subtitle: can ? 'Spell learned' : 'A spell you cannot learn',
      text: can
        ? `${def.description}\n\nMana: ${def.mana}. ${this.c.spellSlots.includes(spell) ? 'Added to your spell bar.' : 'Equip it from the Spells menu.'}`
        : `${def.description}\n\nThe words slide off your mind. ${TOME_REFUSAL[this.c.classId] ?? 'Your class cannot learn this.'}`,
      options: [{ label: 'Close' }],
    });
  }

  private page(it: Interactable) {
    const g = this.g;
    const page = PAGES.find((p) => p.id === it.id)!;
    it.used = true;
    if (it.object) it.object.visible = false;
    g.state.taken.push(it.id);
    const n = PAGES.filter((p) => g.state.taken.includes(p.id)).length;
    const st = this.quest('pages');
    if (st.state === 'active') g.questProgress('pages', 1);
    g.audio.play('pickup');
    this.open({ title: `A torn page (${n}/3)`, text: this.chronicle(page.text), glitch: page.id === 'page-3', options: [{ label: 'Keep it' }] });
  }

  private mine(it: Interactable) {
    const g = this.g;
    const n = this.c.roleId === 'blacksmith' ? 2 : 1;
    this.c.items['ember-ore'] = (this.c.items['ember-ore'] ?? 0) + n;
    it.used = true;
    if (it.object) it.object.visible = false;
    g.state.oreRegrow[it.id] = g.gameMinutes + 180;
    g.hud.toast(`+${n} Ember Ore`);
    g.questProgress('ore', 0);
    const st = this.quest('ore');
    if (st.state === 'active' && st.progress >= QUESTS.ore.goal) g.hud.toast('Ember Ore: return to Brann.', 'quest');
    g.audio.play('pickup');
  }

  forge(npc: boolean) {
    const c = this.c;
    const g = this.g;
    const token = (c.items['free-upgrade'] ?? 0) > 0;
    const options: DialogOption[] = c.weapons.map((w, i) => {
      const def = WEAPONS[w.id];
      if (w.level >= MAX_WEAPON_LEVEL) return { label: `${def.name} Lv ${w.level} (max)`, disabled: true };
      const cost = upgradeCost(c, w);
      const ore = c.items['ember-ore'] ?? 0;
      const afford = token || (c.gold >= cost.gold && ore >= cost.ore);
      return {
        label: `${def.name} Lv ${w.level} → ${w.level + 1}  (${token ? 'free: Brann’s Token' : `${cost.gold} embers${cost.ore ? `, ${cost.ore} ore` : ''}`})`,
        disabled: !afford,
        action: () => {
          if (token) c.items['free-upgrade']!--;
          else {
            c.gold -= cost.gold;
            c.items['ember-ore'] = ore - cost.ore;
          }
          c.weapons[i].level++;
          if (i === c.mainHand) g.player.equip();
          g.audio.play('slam');
          g.fx.emit(g.player.center(), { color: 0xffa040, count: 40, speed: 6, life: 0.5 });
          g.hud.toast(`${def.name} is now level ${c.weapons[i].level}.`);
          this.forge(npc);
        },
      };
    });
    if (runesHeld(c).length) options.push({ label: 'Inscribe a rune on a weapon', action: () => this.inscribeWhich(npc) });
    options.push({ label: 'Done' });
    this.open({
      title: npc ? "Brann's Forge" : 'Anvil',
      subtitle: c.roleId === 'blacksmith' ? 'Blacksmith: half price' : undefined,
      text: `Embers: ${c.gold}   Ember Ore: ${c.items['ember-ore'] ?? 0}`,
      options,
    });
  }

  /** Brann's steel (and runes) or Quill's curios. */
  private shop(id: ShopId) {
    const c = this.c;
    const g = this.g;
    const options: DialogOption[] = shopStock(id).map((w) => {
      const owned = c.weapons.some((x) => x.id === w.id);
      const check = canWield(c, w.id);
      return {
        label: owned ? `${w.name} (yours)` : `${w.name}: ${w.price} embers${check.ok ? '' : ' (not for your class)'}`,
        disabled: owned,
        action: () => this.offer(id, w.id),
      };
    });
    if (id === 'brann') {
      for (const r of Object.values(RUNES)) {
        options.push({
          label: `${r.name}: ${r.price} embers (${r.description.toLowerCase().replace(/\.$/, '')})`,
          disabled: c.gold < r.price,
          action: () => {
            if (buyRune(c, r.id)) {
              g.audio.play('pickup');
              g.hud.toast(`${r.name} bought. Inscribe it on a weapon at an anvil.`);
            }
            this.shop(id);
          },
        });
      }
      if (ownsKnives(c) && c.knives < MAX_KNIVES) {
        options.push({
          label: `Refill your throwing knives (25 embers)`,
          disabled: c.gold < 25,
          action: () => ((c.gold -= 25), (c.knives = MAX_KNIVES), g.audio.play('pickup'), this.shop(id)),
        });
      }
    }
    options.push({ label: 'Back', action: () => this.talk(id) });
    this.open({
      title: id === 'brann' ? "Brann's Steel" : "Quill's Curios",
      subtitle: `You have ${c.gold} embers`,
      text: id === 'brann'
        ? 'Greatswords, spears, axes for two hands, knives for throwing. And runes: carve one into a blade at the anvil and it bites with fire, frost, storm or venom.'
        : 'Odd things from far roads. A wand for a mage or a sorcerer, a ring of runes, and music: a lyre to lift your friends, a horn to scatter your foes.',
      options,
    });
  }

  private offer(shop: ShopId, id: string) {
    const c = this.c;
    const g = this.g;
    const w = WEAPONS[id];
    const check = canWield(c, id);
    this.open({
      title: w.name,
      subtitle: `${w.price} embers · ${w.damage} damage`,
      text: `${w.description ?? ''}${check.ok ? '' : `\n\n${check.reason}`}`,
      options: [
        {
          label: `Buy it (${w.price} embers)`,
          disabled: c.gold < (w.price ?? 0),
          action: () => {
            const err = buyWeapon(c, id);
            if (err) return g.hud.toast(err, 'warn');
            g.audio.play('pickup');
            g.save();
            this.open({
              title: w.name,
              subtitle: 'Bought',
              text: check.ok ? 'It is yours. Wield it now?' : 'It is yours, though it will not answer to you. It rests in your pack.',
              options: check.ok
                ? [{ label: 'Wield it', action: () => ((c.mainHand = c.weapons.length - 1), g.player.equip()) }, { label: 'Keep shopping', action: () => this.shop(shop) }]
                : [{ label: 'Keep shopping', action: () => this.shop(shop) }],
            });
          },
        },
        { label: 'Back', action: () => this.shop(shop) },
      ],
    });
  }

  /** At an anvil: which weapon takes the rune… */
  private inscribeWhich(npc: boolean) {
    const c = this.c;
    const options: DialogOption[] = c.weapons.map((w, i) => {
      const def = WEAPONS[w.id];
      return {
        label: `${def.name}${w.rune ? ` (bears the ${RUNES[w.rune].name})` : ''}`,
        disabled: !canBearRune(w.id),
        action: () => this.inscribeWith(npc, i),
      };
    });
    options.push({ label: 'Back', action: () => this.forge(npc) });
    this.open({ title: 'Inscribe a rune', subtitle: 'Choose a weapon', text: 'A rune carved into a weapon glows on it and adds its power to every hit. A rune already there comes back to your pack. Legendary weapons will not take one.', options });
  }

  /** …and which rune. */
  private inscribeWith(npc: boolean, index: number) {
    const c = this.c;
    const g = this.g;
    const w = c.weapons[index];
    const options: DialogOption[] = runesHeld(c).map(([id, n]) => ({
      label: `${RUNES[id].name} ×${n}: ${RUNES[id].description}`,
      disabled: w.rune === id,
      action: () => {
        if (!inscribe(c, index, id as RuneId)) return;
        if (index === c.mainHand) g.player.equip();
        g.audio.play('slam');
        g.audio.play('rune');
        g.fx.emit(g.player.center(), { color: RUNES[id].color, count: 40, speed: 5, life: 0.6 });
        g.hud.toast(`The ${WEAPONS[w.id].name} now bears the ${RUNES[id].name}.`, 'skill');
        g.save();
        this.forge(npc);
      },
    }));
    options.push({ label: 'Back', action: () => this.inscribeWhich(npc) });
    this.open({ title: WEAPONS[w.id].name, subtitle: 'Choose a rune', text: 'Fire burns, frost slows, storm leaps to foes nearby, venom poisons.', options });
  }

  private async fish() {
    const g = this.g;
    g.setMode('event');
    const sailor = this.c.roleId === 'sailor';
    const result = await g.hud.fishing(sailor);
    g.setMode('play');
    if (result === 'none') return g.hud.toast('It got away.');
    const golden = result === 'golden';
    const item = golden ? 'golden-fish' : 'fish';
    this.c.items[item] = (this.c.items[item] ?? 0) + 1;
    g.hud.toast(golden ? 'A golden fish!' : 'You caught a fish!', 'quest');
    g.audio.play('pickup');
    const st = this.quest('fish');
    if (st.state === 'active') g.questProgress('fish', 1);
  }

  private trial(id: string) {
    const g = this.g;
    const t = TRIALS.find((x) => x.id === id)!;
    if (g.state.trialsDone.includes(id)) return g.hud.toast('This trial is conquered.');
    const boss = BOSSES[t.boss];
    this.open({
      title: t.name,
      subtitle: `Recommended level ${t.level}`,
      text: `${t.intro}\n\n${boss.name}, ${boss.title}, guards the ${rewardName(boss.reward, WEAPONS)}. Once you begin, the fog will seal you in until one of you falls.`,
      options: [{ label: 'Begin the trial', action: () => g.startTrial(t) }, { label: 'Not yet' }],
    });
  }

  private recoverEmbers() {
    const g = this.g;
    const l = g.state.lostEmbers;
    if (!l) return;
    this.c.gold += l.amount;
    g.hud.toast(`Recovered ${l.amount} embers.`);
    g.state.lostEmbers = null;
    g.restoreWorldObjects();
    g.audio.play('pickup');
  }

  private legendary(weaponId: string) {
    const g = this.g;
    const c = this.c;
    if (isRelic(weaponId)) {
      // A relic works from the pack, for any hero.
      const r = RELICS[weaponId];
      g.claimLegendary(weaponId);
      c.items[weaponId] = 1;
      // The pearl's boon: one more flask, filled at once.
      if (weaponId === 'leviathan-pearl') (c.flasksMax++, (c.flasks = c.flasksMax));
      g.player.hp = Math.min(g.player.maxHp, g.player.hp);
      g.audio.play('victory');
      g.save();
      return this.open({ title: r.name, subtitle: 'Relic of an elder foe', text: `${r.boon}\n\nIts power is yours as long as you carry it.`, options: [{ label: 'Close' }] });
    }
    const def = WEAPONS[weaponId];
    g.claimLegendary(weaponId);
    c.weapons.push({ id: weaponId, level: 1 });
    const check = canWield(c, weaponId);
    g.audio.play('victory');
    g.save();
    this.open({
      title: def.name,
      subtitle: 'Legendary weapon',
      text: `${def.description}\n\n${check.ok ? (check.partial ? `You can wield it, but: ${check.reason}` : 'It answers to you.') : `${check.reason} It rests in your pack, silent.`}`,
      options: check.ok
        ? [{ label: 'Wield it', action: () => ((c.mainHand = c.weapons.length - 1), g.player.equip()) }, { label: 'Keep it in my pack' }]
        : [{ label: 'Close' }],
    });
  }

  intro() {
    const c = this.c;
    const touch = this.g.input.touch;
    this.open({
      title: 'Hearthhold',
      subtitle: 'The Golden Reach',
      text: this.chronicle(
        `${c.name} wakes beside the shrine of Hearthhold. Far to the north, beyond the smoking peak, the Giant still holds the world in its palm.\n\n` +
          'Orrin, Keeper of the Archive (west side of the square), knows of the six trials. The townsfolk all have work for a hero.\n\n' +
          (c.raceId === 'angelic'
            ? `Your wings are ready: ${touch ? 'tap ⤒' : 'press Space'} again in the air to beat them, and hold it to glide.\n\n`
            : c.raceId === 'zombie'
              ? 'Death has already tried once. Between rests at a shrine, it will let go of you one more time.\n\n'
              : c.raceId === 'orc'
                ? 'Hurt badly, an orc roars: foes nearby reel, and your blows land harder.\n\n'
                : '') +
          (touch
            ? 'Left thumb: move (push past the ring to sprint). Right thumb: look. ⚔ attack, ⤿ roll, 🛡 block, ✦ cast, ❂ ability, 🔒 shift lock. ✋ appears when you can talk, rest or pick something up. ☰ for the menu and controls.'
            : 'WASD to move, mouse to look (click to capture it). Left click attacks, C rolls, hold Shift to sprint, tap Shift for shift lock, Q casts, R uses your ability. Esc for the menu and the full controls.'),
      ),
      options: [{ label: 'Begin' }],
    });
  }

  // ---------------------------------------------------------------- secrets --

  revealMystery() {
    const g = this.g;
    g.state.flags.eyesRevealed = true;
    g.audio.play('devil');
    this.open({
      title: '******',
      subtitle: 'The elven secret wakes',
      glitch: true,
      text:
        'A whisper behind your eyes finishes the word at last.\n\nYou are EYE-TOUCHED.\n\n• The Watchers will not strike first.\n• You can feel where the eyes are carved: the ruins are now on your map.\n• But the dark bites deeper (+20% dark damage taken).',
      options: [{ label: '…' }],
    });
  }

  lookedAtTheEyes() {
    const g = this.g;
    const c = this.c;
    if (c.raceId === 'ancient') {
      if (!g.state.flags.eyesKin) {
        g.state.flags.eyesKin = true;
        g.gainXp(500);
      }
      g.hud.toast('The eyes look back… and recognise their own.', 'devil');
      return;
    }
    g.state.flags.eyesSeen = true;
    const unlocked = g.unlockAncient();
    g.setMode('event');
    g.hud.glitch(3);
    g.audio.play('devil');
    this.open({
      title: ANCIENT_GLYPH,
      glitch: true,
      text: 'Residue suggests the carvings were once dyed to glow in the dark.\n\nYou looked at the eyes.\n\nAnyone who saw these eyes died shortly after. Always a horrible and painful death.',
      options: [{
        label: 'Wait. I looked at the eyes. I’M NEXT!',
        action: () => {
          g.setMode('play');
          g.playerDied('You looked at the eyes.');
          if (unlocked) {
            setTimeout(() => {
              this.open({
                title: 'Something ancient remembers you',
                glitch: true,
                text: `A new race can now be chosen for new heroes: ${ANCIENT_GLYPH}.\n\n${this.chronicle('Umm, so I was paid to not ask questions, and just write. Sooo I’m just gonna ignore that.')}`,
                options: [{ label: 'Close' }],
              });
            }, 4800);
          }
        },
      }],
    });
  }
}
