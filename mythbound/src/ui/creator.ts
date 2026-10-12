// Title screen and character creation.

import { ANCIENT_GLYPH, CLASSES, RACES, ROLES, SUBCLASSES, type ClassId, type Element, type RaceId, type RoleId, type SubclassId } from '../data/defs';
import { classStats, createCharacter, subclassesFor, validateChoice, type Character, type CharacterChoice } from '../rules/character';
import { loadUnlocks } from '../engine/state';

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

type Step = 'class' | 'subclass' | 'race' | 'role' | 'name';

const CLASS_ICON: Record<ClassId, string> = { warrior: '⚔', ranger: '🏹', mage: '✦', monk: '☯', sorcerer: '🔮', rogue: '🗡' };
const SUB_ICON: Partial<Record<SubclassId, string>> = { ironfist: '👊', windwalker: '🍃', darkmage: '🌑', lightmage: '☀', shadow: '🌘', duelist: '🤺' };

/** A class card's numbers at level 1: health, mana, stamina and speed, as bars. */
function statBars(id: ClassId): string {
  const st = classStats(id);
  const bar = (label: string, v: number, max: number, cls: string, text = String(Math.round(v))) =>
    `<div class="cstat ${cls}"><span>${label}</span><i><b style="width:${Math.round(Math.min(1, v / max) * 100)}%"></b></i><em>${text}</em></div>`;
  return `<div class="cstats">${bar('HP', st.hp, 130, 'hp')}${bar('Mana', st.mana, 90, 'mana')}${bar('Stamina', st.stamina, 130, 'stam')}${bar('Speed', st.speed, 8, 'speed', st.speed.toFixed(1))}</div>`;
}
const RACE_ICON: Record<RaceId, string> = { elf: '🌿', draco: '🐉', human: '🛡', zombie: '🧟', angelic: '😇', orc: '👹', ancient: '◉' };
const ROLE_ICON: Record<RoleId, string> = { historian: '📜', blacksmith: '⚒', sailor: '⚓', darkslayer: '☠', knight: '☀', assassin: '🗡' };

/** Lines from the chronicler, shown as you choose. */
const CHRONICLE: Partial<Record<Step, string>> = {
  class: 'Pick your class.',
  subclass: 'Pick your subclass.',
  race: 'Choose your race.',
  role: 'Choose your role. Seriously, who comes up with these things?',
  name: 'And what shall I write as your name?',
};

export function showCreator(root: HTMLElement, onDone: (c: Character) => void, onBack: () => void) {
  const unlocks = loadUnlocks();
  const choice: CharacterChoice = { name: '', classId: 'warrior', subclassId: null, raceId: 'human', roleId: 'historian', expansion: false };
  let step: Step = 'class';
  const el = document.createElement('div');
  el.className = 'creator';
  root.appendChild(el);

  const steps = (): Step[] => (subclassesFor(choice.classId, choice.expansion).length ? ['class', 'subclass', 'race', 'role', 'name'] : ['class', 'race', 'role', 'name']);

  const card = (key: string, icon: string, name: string, blurb: string, traits: string[], selected: boolean, extra = '', locked = false) => `
    <button class="card${selected ? ' on' : ''}${locked ? ' locked' : ''}" data-key="${esc(key)}" ${locked ? 'data-locked="1"' : ''}>
      <div class="cicon">${icon}</div><div class="cname">${esc(name)}</div><div class="cblurb">${esc(blurb)}</div>
      <ul>${traits.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>${extra}
    </button>`;

  const render = () => {
    const list = steps();
    const idx = list.indexOf(step);
    let cards = '';
    if (step === 'class') {
      cards = (Object.keys(CLASSES) as ClassId[]).map((id) => card(id, CLASS_ICON[id], CLASSES[id].name, CLASSES[id].blurb, CLASSES[id].traits, choice.classId === id, statBars(id))).join('');
    } else if (step === 'subclass') {
      cards = subclassesFor(choice.classId, choice.expansion).map((id) => {
        const s = SUBCLASSES[id];
        const extra = id === 'elemental' && choice.subclassId === 'elemental'
          ? `<div class="elements">${(['fire', 'water', 'wind', 'earth'] as Element[]).map((e) => `<span class="el${choice.wizardElement === e ? ' on' : ''}" data-el="${e}">${e}</span>`).join('')}</div>`
          : '';
        return card(id, SUB_ICON[id] ?? (s.expansion ? '✧' : '⚔'), s.name + (s.expansion ? ' (expansion)' : ''), s.blurb, s.traits, choice.subclassId === id, extra);
      }).join('');
    } else if (step === 'race') {
      cards = (Object.keys(RACES) as RaceId[]).map((id) => {
        const r = RACES[id];
        if (r.secret && !unlocks.ancient) {
          return card(id, '?', '▓▓▓ ▓▓', 'A race so old its language has been lost to time.', ['It is assumed that they are humanoid.', 'In the oldest of books and scrolls…', '…there are eyes. Lots of eyes.'], false, '<div class="lock">Locked. Somewhere in the world, the eyes are waiting.</div>', true);
        }
        // A zombie may shamble (the default) or stand tall.
        const extra = id === 'zombie' && choice.raceId === 'zombie'
          ? `<div class="elements">${[[1, 'Shamble'], [0, 'Stand tall']].map(([v, label]) => `<span class="el${(choice.hunched !== false ? 1 : 0) === v ? ' on' : ''}" data-hunch="${v}">${label}</span>`).join('')}</div>`
          : '';
        return card(id, RACE_ICON[id], r.name, r.blurb, r.traits, choice.raceId === id, extra);
      }).join('');
    } else if (step === 'role') {
      cards = (Object.keys(ROLES) as RoleId[]).map((id) => card(id, ROLE_ICON[id], ROLES[id].name, ROLES[id].blurb, ROLES[id].traits, choice.roleId === id)).join('');
    }
    const err = step === 'name' ? validateChoice(choice, unlocks.ancient) : null;
    const summary = `${RACES[choice.raceId].name} ${CLASSES[choice.classId].name}${choice.subclassId ? ` · ${SUBCLASSES[choice.subclassId].name}` : ''}${choice.wizardElement ? ` (${choice.wizardElement})` : ''} · ${ROLES[choice.roleId].name}`;
    el.innerHTML = `
      <div class="cpanel${choice.raceId === 'ancient' && step === 'race' ? ' glitch' : ''}">
        <div class="chead">
          <div class="crumbs">${list.map((s, i) => `<span class="${i === idx ? 'on' : i < idx ? 'done' : ''}">${s}</span>`).join('<b>›</b>')}</div>
          ${step === 'class' || step === 'subclass' ? `<label class="exp"><input type="checkbox" ${choice.expansion ? 'checked' : ''}> Use expansion <small>(adds Bowman, Trainer, Elemental Wizard)</small></label>` : ''}
        </div>
        <h2>${esc(CHRONICLE[step] ?? '')}</h2>
        ${step === 'name'
          ? `<div class="namebox"><p class="summary">${esc(summary)}</p>
              <input class="name" maxlength="20" placeholder="Your name" value="${esc(choice.name)}" autocomplete="off">
              ${choice.raceId === 'elf' ? '<p class="hint">Elves: your element and your secret are decided when you are born.</p>' : ''}
              ${choice.roleId === 'assassin' ? '<p class="hint">The chronicler will not be writing much about you.</p>' : ''}</div>`
          : `<div class="cards">${cards}</div>`}
        <div class="cnav">
          <button class="back">${idx === 0 ? 'Title' : 'Back'}</button>
          <span class="err">${err && choice.name ? esc(err) : ''}</span>
          <button class="next primary" ${step === 'name' && err ? 'disabled' : ''}>${step === 'name' ? 'Begin' : 'Next'}</button>
        </div>
      </div>`;

    el.querySelectorAll<HTMLButtonElement>('.card').forEach((b) =>
      b.addEventListener('click', (e) => {
        if (b.dataset.locked) return;
        const key = b.dataset.key!;
        const elPick = (e.target as HTMLElement).closest<HTMLElement>('[data-el]');
        if (step === 'class') {
          choice.classId = key as ClassId;
          choice.subclassId = null;
          choice.wizardElement = undefined;
        } else if (step === 'subclass') {
          choice.subclassId = key as SubclassId;
          if (elPick) choice.wizardElement = elPick.dataset.el as Element;
          if (key !== 'elemental') choice.wizardElement = undefined;
        } else if (step === 'race') {
          choice.raceId = key as RaceId;
          const hunch = (e.target as HTMLElement).closest<HTMLElement>('[data-hunch]');
          choice.hunched = key === 'zombie' ? (hunch ? hunch.dataset.hunch === '1' : choice.hunched) : undefined;
        }
        else if (step === 'role') choice.roleId = key as RoleId;
        render();
      }),
    );
    el.querySelector<HTMLInputElement>('.exp input')?.addEventListener('change', (e) => {
      choice.expansion = (e.target as HTMLInputElement).checked;
      if (choice.subclassId && !subclassesFor(choice.classId, choice.expansion).includes(choice.subclassId)) choice.subclassId = null;
      render();
    });
    const name = el.querySelector<HTMLInputElement>('.name');
    if (name) {
      name.focus();
      name.addEventListener('input', () => {
        choice.name = name.value;
        const err2 = validateChoice(choice, unlocks.ancient);
        el.querySelector<HTMLButtonElement>('.next')!.disabled = !!err2;
        el.querySelector('.err')!.textContent = err2 && choice.name ? err2 : '';
      });
      name.addEventListener('keydown', (e) => e.key === 'Enter' && el.querySelector<HTMLButtonElement>('.next')!.click());
    }
    el.querySelector('.back')!.addEventListener('click', () => {
      if (idx === 0) {
        el.remove();
        onBack();
      } else {
        step = list[idx - 1];
        render();
      }
    });
    el.querySelector('.next')!.addEventListener('click', () => {
      if (step === 'subclass') {
        if (!choice.subclassId) return flash('Pick a subclass.');
        if (choice.subclassId === 'elemental' && !choice.wizardElement) return flash('Pick your element.');
      }
      if (step === 'name') {
        if (validateChoice(choice, unlocks.ancient)) return;
        el.remove();
        onDone(createCharacter({ ...choice, name: choice.name.trim() }));
        return;
      }
      step = list[idx + 1];
      render();
    });
  };
  const flash = (msg: string) => {
    const e = el.querySelector('.err');
    if (e) e.textContent = msg;
  };
  render();
}

export function showTitle(root: HTMLElement, hasSave: boolean, onContinue: () => void, onNew: () => void, onBack?: () => void) {
  const el = document.createElement('div');
  el.className = 'title';
  const unlocks = loadUnlocks();
  el.innerHTML = `
    <div class="tinner">
      <div class="logo">MYTHBOUND</div>
      <div class="orn-rule"></div>
      <div class="tag">Six trials. Six weapons of the old gods. ${unlocks.ancient ? `<span class="glyph">${ANCIENT_GLYPH}</span>` : 'Do not look at the eyes.'}</div>
      <div class="tbtns">
        ${hasSave ? '<button class="primary cont">Continue</button>' : ''}
        <button class="${hasSave ? '' : 'primary '}new">New hero</button>
        ${onBack ? '<button class="back">Back</button>' : ''}
      </div>
      <p class="hint">Offline: one hero, saved on this device only.${hasSave ? ' A new hero replaces it.' : ''} Best with keyboard &amp; mouse or a phone in landscape.</p>
    </div>`;
  root.appendChild(el);
  el.querySelector('.back')?.addEventListener('click', () => {
    el.remove();
    onBack?.();
  });
  el.querySelector('.cont')?.addEventListener('click', () => {
    el.remove();
    onContinue();
  });
  const begin = () => {
    el.remove();
    onNew();
  };
  el.querySelector('.new')!.addEventListener('click', () => {
    if (!hasSave) return begin();
    // Ask in the page itself: browser confirm() dialogs are not always allowed.
    const btns = el.querySelector('.tbtns')!;
    btns.innerHTML = '<p class="warn">Start a new hero? Your saved hero is replaced when you begin.</p><button class="primary yes">Start a new hero</button><button class="no">Keep my hero</button>';
    btns.querySelector('.yes')!.addEventListener('click', begin);
    btns.querySelector('.no')!.addEventListener('click', () => {
      el.remove();
      showTitle(root, hasSave, onContinue, onNew, onBack);
    });
  });
}
