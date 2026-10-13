# Mythbound

A dark-fantasy, third-person 3D action RPG that runs in the browser on PC and phone. You pick a class (Warrior, Ranger,
Mage, Monk, Sorcerer or Rogue), subclass, race and role, then explore a world of nine regions, take quests from the people of Hearthhold, and conquer six trials whose
bosses guard the weapons of the old gods.

## Play

```sh
npm install
npm run dev          # http://localhost:5173
npm run build        # static site in dist/
npm run build:single # dist-single/Mythbound.html: one file, double-click to play
npm test             # rules and terrain tests
```

Progress saves automatically (at shrines, every minute, and on quit) in the browser's local storage.

### Controls

| Keyboard & mouse | Touch | Action |
| --- | --- | --- |
| WASD, mouse (click to capture) | left thumb, right thumb drag | move, look |
| Shift tap | 🔒 | toggle shift lock |
| Shift hold | push stick far | sprint |
| C | ⤿ | roll / dodge (rolls through attacks; a Monk dashes, or backflips standing still) |
| Left click (hold with a bow) | ⚔ | attack / draw and shoot |
| E | 💥 | heavy attack (Swordsman: Spinner Flourish); hold to charge a power strike |
| Right click | 🛡 | block / raise shield |
| Space | ⤒ | jump (Draco: fly up) |
| Z | ▼ | sneak |
| Q (hold for alternate form) | ✦ | cast the selected spell (hold to keep a channelled beam flowing) |
| 1-4, mouse wheel | tap a spell slot | choose spell |
| R | ❂ | class ability: BloodRage, Power Shot, Tame, Combine, Volley, Flurry of Blows, Arcane Surge, Vanish |
| G / V | ⊕ / 🪽 | combine spells (Mage Lv 3+) / fly (Draco Lv 6+) |
| Tab, middle click | ◎ | lock on |
| H / X / T | ⚗ / 🐟 / ⇄ | flask / eat fish / switch weapon |
| F | ✋ | interact |
| M, Esc | 🗺, ☰ | map (fast travel between shrines), menu |

**Shift lock** (a quick tap of Shift, or 🔒 on touch) turns the hero to face wherever the camera looks, pulls the camera
over the shoulder and shows a crosshair, so you can strafe, back-pedal and aim spells and arrows precisely. Tap again to
release it. Holding Shift still sprints.

## Accounts and hero slots

The front screen offers **Log in**, **Create account** and **Play offline**. An account is a username and a password
(no email) kept on the co-op server, and holds up to five heroes. Log in on any device (PC, phone, iPad) to play them.

- Creating an account shows a **recovery code** once; it is the only way to set a new password if you forget yours.
- Saves upload while you play (at most every 20 seconds, and at once when you quit or hide the page). A copy stays on
  the device, so progress made without internet is offered next time you load that hero there.
- Two devices can't silently undo each other: if a hero was saved on another device since this one loaded it, this
  device stops uploading and says so.
- **Play offline** keeps the original single hero on this device; it can be copied into an empty account slot.
- Accounts need the server's database (see `../mythbound-server/README.md`); without it the game says so and offline
  play still works.

## Co-op (2–4 players)

Open the menu (Esc or ☰) and choose **Co-op**. One player presses **Host a game** and reads out the five-letter room
code; friends type it and press **Join**. Co-op needs the online version
(https://petermayfieldlogistics-oss.github.io/jarvis/mythbound/); the relay server is in `../mythbound-server`.

- The host's world is shared: its monsters, bosses and time of day. Each player's hero, items, skills and progress stay
  their own and save on their own device.
- Monsters hunt whichever hero is closest. Everyone near a kill (or who hurt the monster) gets its XP and embers.
- Anyone can begin a trial; everyone standing near the altar is sealed in with them and the boss grows tougher for each
  extra hero. Everyone inside wins the legendary weapon (once each). If the heroes inside all fall, the trial is lost.
- With friends, the world never pauses: menus don't stop it, and resting at a shrine doesn't bring monsters back. The
  host should keep the game tab open and in view.
- **Team combos**: strike the same foe as a friend within 4 seconds, each with a different element (a spell, a rune, an
  elemental weapon or a power strike), and the two combine. Every pair of the seven elements (fire, water, wind,
  earth, lightning, light, dark) makes its own combo, 21 in all: Scalding Steam blinds, Conduction stuns every soaked
  foe, Blizzard freezes, Wildfire spreads flames, Holy Tide mends you both, Eclipse ignores resistances, and so on (the
  full list is under Menu → Co-op → Team combos). It adds 50–150% of both blows to the foe, half that to foes around
  it, and its effect; a foe can be caught again after 3 seconds. The host's game decides; everyone sees the combo's
  name and the two heroes who made it.
- The free server naps after 15 minutes without players, so the first connection can take up to a minute.

## The world

- **Hearthhold** (town): Orrin the Historian (main quest, spell tomes), Brann the Smith (upgrades), Sister Lumen
  (healing, light magic), Quill the merchant, Mara the fisher (on the coast), and the Chronicler.
- **Regions**: the Golden Reach, Whisperwood, the Ashen Dunes, Molten Peak, the Sunken Coast (and its island), the
  Weeping Mire, Hecate's Crossroads and the Field of Mars.
- **Six trials** (fog-walled boss arenas): Hunt → Bow of Artemis, Tides → Poseidon's Trident, Storms → Master Bolt,
  Forge → Hammer of Hephaestus, War → Sword of Mars, Crossroads → Staff of Hecate.
- **Souls-like loop**: shrines restore you and respawn the world; dying drops your embers where you fell; flasks refill
  at shrines; day and night (one game hour is one real minute).

## How the design notes became rules

Everything lives in `src/data/defs.ts` (content) and `src/rules/` (pure, tested logic). Where the notes left room, this
is what was chosen; each is easy to change:

- **Warrior**: +25% melee, flat unless wielding the Sword of Mars or in **BloodRage** (12 mana, 20 s, 40 s cooldown),
  where each landed hit adds +25% and a miss resets it. Stacks are capped at 12 (4x). Shield blocks all damage but
  costs stamina; an empty stamina bar breaks your guard. Bloodsteal from level 4 as written.
- **Ranger**: Quick Draw halves bow draw time and speeds melee. Sky magic = Wrath of Thor and Way of the Wind. Rangers
  and Mages are the only classes that can learn Wrath of Thor.
- **Mage**: all five level 1 spells from the start; Blade of Retribution, Soul or Power and Power of the Light (plus two
  extra spells, Stone Skin and Moonveil) are tomes hidden in the world. From level 3, Combine turns two spells into one
  of six combinations (Firestorm, Storm Surge, Scalding Geyser, Tempest, Thunderfire, Frost Gale).
- **Monk** (Iron Fist or Wind Walker): fights with hand wraps (jab, cross, kick; heavy is a palm strike that throws foes
  back), quarterstaffs, staves and spears. Mana is chi: landed blows restore it, techniques spend it (Palm Shockwave,
  Meditate, Iron Skin or Cyclone Kick). Rolls are dashes, a backstep is a backflip, a second jump flips in the air.
  **Flurry of Blows** (R): eight punches on the foe in front (a Wind Walker dashes in first). Learns from a class tree and
  a subclass tree.
- **Sorcerer** (Dark Mage or Light Mage): +20% spell power, wands and rune circles cost less. Channelled spells pour out
  while cast is held. Dark Mage: Shadow Bolt, Life Drain (heals you), Hex (+25% damage taken, -25% dealt; leaps on
  death), Summon Shade. Light Mage: Radiant Beam, Smite Undead, Mending Light and Ward of Dawn (both reach co-op
  friends). **Arcane Surge** (R): 8 s of free, stronger spells.
- **Rogue** (Shadow or Duelist): daggers and knives +15%, backstabs +50% from behind and triple from stealth, quieter,
  evasive rolls. Tricks: Smoke Bomb (foes inside are blinded, you hide), Poison Blades (poison stacks three times),
  Shadowstep (blink behind a foe) or Parry (turn a blow aside and riposte for triple). **Vanish** (R): every foe loses
  you; the next strike is an ambush.
- **Power strikes**: hold heavy (E or 💥) to charge; a quick tap is still a plain heavy. The hero winds up, glows in
  the strike's colour and a ring on screen fills (full after about a second). Let go for the weapon's heavy move at
  1.5x to 2.5x, bursting with the weapon's rune, else its element, else the hero's own (a Draconian's fire, a monk's
  wind, a Knight's or Light Mage's light, a Dark Mage's dark, an elf's or Elemental Wizard's element; plain steel
  makes a staggering shockwave). Fire leaves burning ground, frost freezes then slows, lightning leaps to up to five
  foes and stuns, earth throws foes up, wind hurls them back, light smites (double on dark creatures) and mends you,
  dark drains life back. Costs 22 stamina plus a little while held, then 6 s before the next. A bow charges an
  elemental arrow; Mages and Sorcerers pour it into their selected attack or healing spell (half again the mana, up to
  twice as strong, and it bursts where it lands; an empowered beam flows on its own for a few seconds). Pacts and
  wards (Deal with the Devil, Soul or Power, Power of the Light) can't be empowered; instruments don't charge. Co-op
  friends see the charge-up, glowing projectiles and burning ground.
- **Deal with the Devil**: lock on to one-shot a single foe (bosses too, as written), otherwise it takes every level
  1–5 foe nearby. You black out, and light magic is sealed for 1, 2, then 3 game hours; the 4th deal seals it forever.
- **Expansion** (toggle in the creator): Bowman (level 2 copper bow, 50 steel arrows, Power Shot: 6x damage plus 0.5 NDP
  in a radius that grows with level, only on an enemy that hasn't noticed you), Trainer (tame wolves at level 1, boars 3,
  scorpions 5, magma hounds 7, drakes 9), Elemental Wizard (+50% power and -25% cost in your element).
- **Elf**: +20% mana and spell power, faster, level 3 bow, Imp magic (Deal with the Devil and an Imp Familiar) for any
  elf class, a random element (25% each). The 33% ****** stays hidden until it wakes.
- **Draco**: water burns at exactly level 5; wings at level 6 carry one game hour of flight, plus an hour per level;
  half fire damage; at level 10, lava heals 10 HP a second.
- **༼ ∞ኒ**: locked until you find the eye carvings in the world. Playable afterwards, with the Gaze, Thunderheart and
  lizard-kin.
- **Legendaries**: Sword of Mars needs a Warrior; Bow of Artemis a Ranger (full power for an Elf ranger); the Master Bolt
  can be thrown by anyone but only a Ranger avoids half damage and the shock; Staff of Hecate needs a Mage; Hammer of
  Hephaestus a Blacksmith; Poseidon's Trident a Sailor (it also lets you walk on water).
- **Roles**: Historian (reads ancient carvings, sees enemy health and weaknesses, +15% XP), Blacksmith (half-price
  upgrades, double ore), Sailor (boats from any dock, tireless swimming, better fishing), Dark Slayer (+50% vs dark
  creatures, night vision, wounded dark creatures flee), Knight of the Light (Holy Smite, Radiant Heal, Aegis of Light),
  Assassin (sneak, 4x backstabs on unaware foes, a dagger, and the Chronicler's pages arrive "edited").

<details>
<summary>Spoilers: the elven secret</summary>

The ****** wakes at night once an elf reaches level 3, or near the eye ruins: the elf is **Eye-Touched**. Watchers
won't strike first, the ruins appear on the map, but dark damage hurts 20% more.
</details>

## Code map

- `src/data/` – classes, races, roles, spells, weapons, monsters, bosses, places, quests, lore
- `src/rules/` – character creation, stats, combat and spell rules (unit tested)
- `src/engine/` – terrain, world building, models, player, monsters and bosses, effects, game loop, story
- `src/ui/` – title, character creator, HUD (framed stat and boss bars, spell cooldown sweeps, compass minimap), menus,
  dialogs; the gold ornaments are inline SVGs in `src/styles.css`
