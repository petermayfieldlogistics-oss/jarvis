# Mythbound

A dark-fantasy, third-person 3D action RPG that runs in the browser on PC and phone. You pick a class (Warrior, Ranger,
Mage, Monk, Sorcerer or Rogue), subclass, race and role, then explore a world of fifteen regions, take quests from the people of Hearthhold, and conquer six trials whose
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
| B (Shift gallops) | 🐎 (push stick far) | call your horse, climb on, get down |
| Tab, middle click | ◎ | lock on |
| H / X / T | ⚗ / 🐟 / ⇄ | flask / eat (fish, crops) / switch weapon |
| Y | 🍎 (shown while you carry fruit or sweets) | satchel: eat a fruit or sweet for its buff |
| F | ✋ | interact |
| M, Esc | 🗺, ☰ | map (fast travel between shrines), menu |

**Shift lock** (a quick tap of Shift, or 🔒 on touch) turns the hero to face wherever the camera looks, pulls the camera
over the shoulder and shows a crosshair, so you can strafe, back-pedal and aim spells and arrows precisely. Tap again to
release it. Holding Shift still sprints.

**On a phone** the stick appears wherever your left thumb lands on the lower-left of the screen, ignores a resting
thumb, and slides along if your thumb wanders past the ring. As you run, the camera swings in behind you, so one thumb
can steer (never round to face you when you run back toward it, and not for a moment after you turn it yourself; turn
it off under Settings, "Camera follows you"). Drag anywhere else, including the top of the screen, to look around.

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

## Player against player

PvP happens in co-op games, in three ways. All of it is under Menu → Co-op → **⚔ Player against player**.

- **Duels**: press **⚔ Duel** next to a friend in the menu, or stand by them and press **F** (✋ on touch). They answer
  with Accept (F, or tap) or Decline. A ring of fog rises between you (12 m across each way) and the count goes 3, 2,
  1, FIGHT. Both start with full health, mana and stamina. The first to fall yields: nobody dies, nothing is lost, and
  you are both healed afterwards. For a few seconds after, F asks for a rematch. Monsters are kept out of the ring.
  A duel that runs past 3 minutes is a draw.
- **The Arena of Ares** (south-east of town, ringed by standing stones): the host chooses everyone for themselves or
  two teams (Crimson and Azure, split evenly by level), first to 5, 10 or 15 falls, and 3, 5 or 10 minutes, then
  calls everyone. Those who join (F or tap) are carried to the arena's edge, count down from 5 and fight. A fallen hero
  rises at their place after 4 seconds, safe for a moment. The scoreboard shows the falls and the clock (at the
  bottom of the screen on phones), and the side shows who felled whom. When a team or hero reaches the goal (or time
  runs out), everyone sees the results and goes back to where they were.
- **War mode** (a tick box): heroes who both have it on can attack each other anywhere but in town and by the
  shrines. A hero felled this way loses no embers. War mode can't be turned off in the middle of a fight.
- **How blows land**: every weapon, spell, burst, pet and trap that hurts monsters hurts a hostile hero, but at
  55% of what it would deal a monster, and never more than 30% of the hero's health in one blow (40% for what would
  slay a monster outright, like a backstab). Guards, parries, rolls, armour and wards work as against monsters. A stun
  or fear holds a hero for at most a second and can't hold them again for 4 seconds after; roots, slows, burning,
  poison and bleeding are shorter and weaker too. A foe's songs and healing don't help you.
- **Glory and ranks**: wins, falls and arena matches earn glory (more for beating a higher level, less for beating
  the same friend again and again). Ranks: Recruit, Brawler (30), Gladiator (100), Champion (250), Warlord (500) and
  Legend of the Arena (1000). Your rank shows under your name for friends, and your record is in the menu.

## The world

- **Hearthhold** (town): Orrin the Historian (main quest, spell tomes), Brann the Smith (upgrades), Sister Lumen
  (healing, light magic), Quill the merchant, Wren the farmer (seed beds), Nell (fish and fruit, by the shrine), Mara
  the fisher (on the coast), and the Chronicler.
- **The heartland** (the middle of the map): the Golden Reach, Whisperwood, the Ashen Dunes, Molten Peak, the Sunken
  Coast (and its island), the Weeping Mire, Hecate's Crossroads and the Field of Mars.
- **The outer lands** (the world is 1800 m across, four times the heartland), each with a shrine to travel to, its own
  plants, weather and harder monsters (levels 12-16):
  - **The Frostspine** (north): snow-capped ridges parted by a pass, falling snow. Frostfangs and frost trolls.
  - **The Cinderwaste** (north-east): black plains, cinder cones and pools of lava (they burn), drifting embers. Ash
    revenants.
  - **The Sea of Sand** (east): long dunes and palm-ringed oases. Sand reavers.
  - **The Elderwood** (west): a forest of giant trees. Tangle spiders and jungle stalkers.
  - **The Verdant Tangle** (south-west): jungle cut by streams, palms and flowers. Jungle stalkers.
  - **The Wine-Dark Sea** (south): open water with five islands. Sea raiders. Swim or take a boat.
- **Big world on a phone**: the ground and plants are built in tiles near the hero, a few milliseconds a frame, and
  only what the haze lets you see is drawn, so the bigger world costs about what the heartland did. Every player's
  trees and rocks stand in the same places, whatever their quality setting. The map paints in around you as you go.
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
- **Horses**: every hero has one, named and coloured at creation (older heroes get theirs on loading). B or 🐎 whistles
  for it: it gallops in from behind and you climb on (or press F / ✋ beside it). It trots at 8 m/s, and gallops at
  14 m/s while you sprint, on its own stamina (shown in the stamina bar while riding; about 7 seconds from full, then it
  trots until it has its wind back). Jump to jump; it wades but won't swim. No riding in a fight or a trial: you can't
  climb on with a monster hunting you nearby or just after a blow, reaching for a weapon hops you down, and a blow
  throws you from the saddle (the horse bolts and goes home; whistle again). Left behind, it waits; far away it wanders
  home. Friends see you ride, in your horse's coat.
- **Farming**: Wren the farmer keeps a fenced field of nine seed beds just east of Hearthhold's square, by the forge.
  Three beds are yours (the row by the gate); Wren rents the other six (120, then 250 embers each) and gives a first
  pack of carrot seeds. Buy seeds from Wren in packs of four, as food crops (carrots 3 h, wheat 4 h, bluecap mushrooms
  5 h, pumpkins 12 h of play to ripen) or fibre & dye plants for the loom (flax 5 h, madder, woad and weld 7 h).
  At an empty bed pick a crop (food or fibre first, once you carry more than seven kinds), then this bed or every
  empty bed. Stand at a bed and tap ✋ / F: plant, then water (one tap waters the whole row; watered soil
  grows at full speed for 4 h, dry soil at half), and harvest the row when ripe. Nothing withers. A fish fed to a bed
  before it is half grown brings in one more crop (a golden fish, two). Crops grow while you play, not while you pass
  time at a shrine. The field shows a green dot on the minimap and says when crops ripen. Carrots and pumpkins heal,
  bluecaps restore mana; Wren buys any crop, and wheat is for bread later. Wren's quest: bring in four harvests. In
  co-op each hero tends their own crops in the same field.
- **Crafting**: four stations, touch-friendly (tap ✋ at one; recipes you can make are ticked with how many; the rest
  say what's missing; then Make 1, Make 5 or Make all). The first time you make something you learn it (+10 XP).
  - **Cookfire** (by Wren's field): Grilled Fish (+60), Hearth Bread (+40), Root Stew (+75), Fisher's Pie (+160),
    Bluecap Broth (+90 mana), Pumpkin Soup, Golden Feast (+300 HP, +100 mana). Any shrine's flame cooks the simple
    ones (fish and bread).
  - **Workbench** (between the field and the forge): bone arrows, steel-tipped arrows, compost (feed it to a bed: +1
    crop), fishing lures (a wider catch and a better chance of gold; one per cast), a Watering Can (waters every bed
    at once, wet for 6 h) and a Silk Fishing Line (a wider catch on every cast).
  - **Anvil** ("Smith something"): the four runes from ore and monster parts for far less than Brann asks, and
    Horseshoes (your horse gallops a third longer). A Blacksmith pays half the embers. Its Gear group also smiths the
    metal clothes (see Clothing).
  - **Loom** (just north of Wren's field, with three dye vats): Weave (linen from 3 flax, hoods, a mask, a hat, a
    headband), Tailor (jerkin, robe, gi, cloak), Plant dyes, Rare dyes, and Change outfit.
  - **Materials** drop from monsters (each hero rolls their own in co-op): hide (wolves, boars), silk (spiderlings; three
    from Broodmother), chitin (scorpions), kelp (the drowned, or a missed catch), bone (skeletons), wisps (wraiths),
    cinder hearts (imps, magma hounds). Quill buys them (not kelp). The Gear tab groups the pack (food, tools, materials) and has a
    recipe book.
- **Clothing**: purely for looks, no stats. Three slots (Head, Body, Cloak) and four colours (Cloth, Leather/plate,
  Trim, Cloak); "Class's own" is the default for each. 15 garments: free bare head and no cloak; hood, mask, hat,
  headband, jerkin, robe, gi and cloak from the loom; circlet, great helm, legion galea and plate harness from the
  anvil; the Crown of the Six for beating all six weapon trials. 17 colours: making a dye teaches the colour for good
  (seven plant dyes from madder, woad, weld and flax; seven rare ones from cinder hearts, bone, kelp, chitin, drake
  scale, golden fish and ore, watcher lens and wisp), and each elder relic teaches one (Pearl, Tidal Blue,
  Dragonfire). Older heroes get what they already earned when they load. Quill sells some clothes and the three plant
  dyes ("Any curios?"). New materials: linen (bandits), bronze scrap (legionaries), drake scale, watcher lens.
  - **Wardrobe**: opens from the loom, any shrine ("Change outfit") and the Hero tab (which counts Clothes n/15 ·
    Colours n/17). A panel down the right on a wide or sideways screen, a bottom sheet (up to 55%) in portrait; big
    tiles and 48 px swatches; locked ones say how to get them. Each tap dresses the hero, who turns to face you;
    Keep saves it, Undo puts back the saved outfit, Close or Esc leaves it as it was. Only somewhere safe (not
    riding, swimming, flying, sailing, in a trial, in a fight or just hurt). Angelic heroes can't wear a cloak
    (their wings), and the ༼ ∞ኒ keep their own hood.
  - **Co-op**: friends see your outfit after Keep (never the previews). The hello carries seven numbers (garments by
    index, colours as hex), so a friend on an older build with fewer dyes still sees the right colours; a hello
    without them, or with junk, shows your class look. Each hero's wardrobe saves with their own character.
  - **Class looks**: each class's own clothes are cut for it. Warriors wear plate under a great helm (visor slit and
    comb), big rounded pauldrons, mail at the joints, a tattered tabard and scarf, a fur mantle and a ragged cloak;
    monks a robe draped over one shoulder, prayer beads, tattoos and a mark on a shaven brow; sorcerers a tall pointed
    hood, a long beard (on races with a human face) and a flowing robe with bell sleeves; rangers a hood and leaf-cut
    cape over leathers, with a quiver; mages a pointed hat, a stand-up collar and a split robe; rogues sleek leathers,
    crossed straps with throwing knives, a peaked hood and a mask. A body garment keeps the class's cut where it can.
    Heroes are drawn with a thin ink outline, and every humanoid catches the sky's light on its edges and shadowed
    side, so dark clothes keep their shape. Bosses share the ink line (on the creature bosses it bends with them);
    the humanoid bosses wear the heroes' plate and wield the legendaries they drop. Reaper's Edge is a black hooked
    blade with a soul-lit edge and a skull pommel, Venomfang a curved spider fang dripping venom, and the Duelist's
    Saber a curved blade with a brass knuckle bow.
- **Eating**: X / 🐟 eats the right food: the smallest heal when lightly hurt, the biggest below 40% health (as with
  golden fish), mana food at full health; it heals over a moment, a bite a second at most. The Gear tab has an Eat
  button by each food. X never eats fruit or sweets (see below).
- **Fish & fruit (Nell)**: Nell keeps a stall with a sea-blue awning beside the Hearthhold shrine, next to the
  Chronicler. Her dialog (all big numbered buttons) has Fruit… (two shelves of four), Fish & lures… (a fish 12, a
  golden fish 70, three lures 30), Sell your catch, Sell fruit, and "What does fruit do?". Zombies pay a quarter more,
  as everywhere.
  - **Fruit buffs**: eating a fruit fills your one **Fed** slot for some hours of play. Sunberry 20 (stamina back 30%
    faster, 6 h), Heartapple 30 (heals 0.3% of max HP a second, 5 h), Moonplum 30 (mana back 40% faster, 8 h),
    Windpear 35 (8% faster on foot, 6 h), Emberfig / Tideberry / Duskcherry 40–45 (fire / water / dark hurts 35% less,
    8 h; tideberries also let you swim without tiring, duskcherries give a Dark Slayer's night vision), Blood Orange 60
    (weapons and spells hit 12% harder, 5 h). Each also restores a little health or mana. No fruit gives XP or embers.
  - **One slot**: the same fruit again tops the timer up to a full serving; a different fruit replaces the buff (the
    satchel and the Gear tab ask first, then say "Emberfig replaces Windpear"). The buff counts down only while you
    play (never at a shrine's "Pass time", never by a co-op host's clock), says when it wears off, and is lost when
    you die. It multiplies with everything else (a Song of Valor and a blood orange: ×1.40 damage; an emberfig and
    the Heart of the Elder Dragon: fire at ×0.325). A chip under the health bars shows it ("Fed: Emberfig 7h 40m", in
    the fruit's colour).
  - **Eating it**: Y or 🍎 opens the satchel (the button shows only while you carry fruit or sweets): one big row per
    fruit with what it does and for how long; tap (or press 1–8) to eat. The Gear tab has Eat buttons too, and Nell
    offers "Buy and eat now".
  - **Fresh today**: one fruit a day is a quarter off (Nell's day is 24 minutes of your own play time).
  - **Selling**: Nell buys fish for 5 and golden fish for 30, at most 10 a day all told (a cast takes seconds, so more
    would out-earn fighting), and fruit at a quarter of her price. She always pays less than she charges.
  - **Pips**: a raw sunberry or heartapple keeps a pip about one time in three. Plant it in Wren's field (Wren sells no
    pips): sunberries ripen in 9 h (2–3 a bed), heartapples in 14 h (1–2); Nell buys the fruit, or eat it for its buff.
  - **Sweets** (cookfire, "Sweets"): Sunberry Tart (2 sunberries, 1 wheat: the sunberry buff for 9 h, +40 HP) and
    Heartapple Pie (2 heartapples, 1 wheat: the heartapple buff for 7½ h, +60 HP).
  - In co-op each hero's buff, fish count and fresh fruit are their own; friends see the sparkle in the fruit's colour
    when you eat.
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
- **Race looks**: every race but the elf has a head of its own, crisp and faceted. Draco: a dragon's head (long
  ridged snout, toothed jaw, burning eyes, a crest of horns swept back, spined frills), a plated throat, claws, a
  spined tail with belly plates and scalloped wings. Orcs: an underbite jaw with big tusks, a heavy brow, pointed ears,
  a black mohawk, a bull neck, a bigger frame (and spikes through a plate wearer's pauldrons). Angelic: a fine face,
  golden hair in loose locks, a sun-disc halo behind the head and big feathered wings. Humans: a sculpted face with
  brows and eyes that read, swept faceted hair. Zombies: gaunt and mottled, sunken glowing eyes, a lip torn back
  from the teeth, sewn scars. The ༼ ∞ኒ: no face in the hood at all, only glowing eyes and runes.
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
- `src/engine/` – terrain, world building, models, player, monsters and bosses, effects, game loop, story; co-op in
  `coop.ts` and player-against-player in `pvp.ts` (a hostile hero gets a stand-in among the monsters, so every attack
  can reach them; the blow is sent to that player's game, which lands it on their hero)
- `src/ui/` – title, character creator, HUD (framed stat and boss bars, spell cooldown sweeps, compass minimap), menus,
  dialogs; the gold ornaments are inline SVGs in `src/styles.css`

## Blender models

Weapons and the shield are modelled in Blender by `blender/weapons.py`, which
writes `src/assets/weapons.glb`. To rebuild them (Blender as a Python module):

    uv venv -p 3.13 .blenv && uv pip install -p .blenv/bin/python bpy
    .blenv/bin/python blender/weapons.py --preview   # renders blender/preview/*.png too

The game loads the file before building the world and falls back to the
models made in code for anything it lacks.
