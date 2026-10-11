// The front screen and accounts: log in, create an account (and keep its
// recovery code), reset a forgotten password, and pick one of the account's
// hero slots. "Play offline" leads to the original single-save title.

import { ANCIENT_GLYPH, CLASSES, RACES } from '../data/defs';
import { CloudError, type Cloud, type SlotInfo } from '../engine/cloud';
import { loadSave, loadUnlocks, saveUnlocks, type SaveData } from '../engine/state';

/** What makes a username or password acceptable, said plainly (the server checks the same). */
function checkName(name: string): string | null {
  if (!name) return 'Type a username.';
  if (/\s/.test(name)) return 'Usernames can\'t have spaces. Use letters, numbers or _ (like Dragon_Slayer).';
  if (!/^[A-Za-z0-9_]+$/.test(name)) return 'Usernames can only use letters, numbers and _ (no other symbols).';
  if (name.length < 3) return 'Usernames need at least 3 characters.';
  return null;
}
function checkPassword(pw: string): string | null {
  if (pw.length < 6) return 'Your password needs at least 6 characters.';
  return null;
}

const esc = (s: string) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export interface FrontActions {
  cloud: Cloud;
  /** The single offline save on this device. */
  offline: () => void;
  /** Play the hero in an account slot (`version` is the server's copy it came from). */
  play: (slot: number, save: SaveData, version: number) => void;
  /** Make a new hero for an empty slot. */
  create: (slot: number) => void;
}

function screen(root: HTMLElement, inner: string): HTMLElement {
  root.querySelector('.title')?.remove();
  const el = document.createElement('div');
  el.className = 'title';
  el.innerHTML = `<div class="tinner">
    <div class="logo">MYTHBOUND</div>
    <div class="orn-rule"></div>
    ${inner}
  </div>`;
  root.appendChild(el);
  // Typing in a field must not steer the hero or open menus behind it.
  el.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => e.stopPropagation()));
  return el;
}

/** Shows progress or a problem under a form, and disables its buttons while busy. */
function statusLine(el: HTMLElement) {
  const line = el.querySelector<HTMLElement>('.astatus')!;
  // Back always works, even while waiting for a sleeping server.
  const buttons = () => el.querySelectorAll<HTMLButtonElement>('button:not(.back)');
  return {
    busy(text: string) {
      line.className = 'astatus busy';
      line.textContent = text;
      buttons().forEach((b) => (b.disabled = true));
    },
    fail(err: unknown) {
      line.className = 'astatus bad';
      line.textContent = err instanceof CloudError || err instanceof Error ? err.message : 'Something went wrong. Try again.';
      buttons().forEach((b) => (b.disabled = false));
    },
    done() {
      line.className = 'astatus';
      line.textContent = '';
      buttons().forEach((b) => (b.disabled = false));
    },
  };
}

export function showFront(root: HTMLElement, a: FrontActions) {
  const signed = a.cloud.session;
  // Start waking the server now, while the player reads and types.
  void a.cloud.warm();
  const unlocks = loadUnlocks();
  const el = screen(
    root,
    `<div class="tag">Six trials. Six weapons of the old gods. ${unlocks.ancient ? `<span class="glyph">${ANCIENT_GLYPH}</span>` : 'Do not look at the eyes.'}</div>
    ${signed ? `<p class="who">Signed in as <b>${esc(signed.username)}</b></p>` : ''}
    <div class="tbtns">
      ${signed
        ? '<button class="primary heroes">Your heroes</button><button class="offline">Play offline</button>'
        : '<button class="primary login">Log in</button><button class="signup">Create account</button><button class="offline">Play offline</button>'}
    </div>
    ${signed ? '<button class="link logout">Log out</button>' : ''}
    <p class="hint">${signed ? 'Your heroes are saved to your account: log in on any device to play them.' : 'An account keeps up to five heroes and lets you play them on any device. Offline heroes stay on this device.'}</p>`,
  );
  el.querySelector('.heroes')?.addEventListener('click', () => showSlots(root, a));
  el.querySelector('.login')?.addEventListener('click', () => showLogin(root, a));
  el.querySelector('.signup')?.addEventListener('click', () => showSignup(root, a));
  el.querySelector('.offline')!.addEventListener('click', () => {
    el.remove();
    a.offline();
  });
  el.querySelector('.logout')?.addEventListener('click', async () => {
    await a.cloud.logout();
    showFront(root, a);
  });
}

function showLogin(root: HTMLElement, a: FrontActions) {
  const el = screen(
    root,
    `<h2 class="atitle">Log in</h2>
    <form class="acct" autocomplete="on" novalidate>
      <label>Username <input name="username" autocomplete="username" maxlength="16" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <label>Password <input name="password" type="password" autocomplete="current-password" maxlength="128"></label>
      <div class="tbtns"><button class="primary" type="submit">Log in</button><button type="button" class="back">Back</button></div>
      <div class="astatus"></div>
      <button type="button" class="link forgot">Forgot your password?</button>
    </form>`,
  );
  const st = statusLine(el);
  const form = el.querySelector('form')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const problem = checkName(String(f.get('username')).trim()) ?? (String(f.get('password')) ? null : 'Type your password.');
    if (problem) return st.fail(new Error(problem));
    try {
      await a.cloud.ready((t) => st.busy(t));
      st.busy('Logging in…');
      await a.cloud.login(String(f.get('username')).trim(), String(f.get('password')));
      showSlots(root, a);
    } catch (err) {
      st.fail(err);
    }
  });
  el.querySelector('.back')!.addEventListener('click', () => showFront(root, a));
  el.querySelector('.forgot')!.addEventListener('click', () => showRecover(root, a));
  el.querySelector<HTMLInputElement>('input')!.focus();
}

function showSignup(root: HTMLElement, a: FrontActions) {
  const el = screen(
    root,
    `<h2 class="atitle">Create an account</h2>
    <form class="acct" autocomplete="on" novalidate>
      <label>Username <input name="username" autocomplete="username" maxlength="16" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <label>Password <input name="password" type="password" autocomplete="new-password" maxlength="128"></label>
      <label>Password again <input name="password2" type="password" autocomplete="new-password" maxlength="128"></label>
      <p class="hint">Username: 3–16 letters or numbers, no spaces (you can use _). Password: at least 6 characters. Don't use your real name, or a password you use anywhere else. There's no email: you'll get a recovery code instead.</p>
      <div class="tbtns"><button class="primary" type="submit">Create account</button><button type="button" class="back">Back</button></div>
      <div class="astatus"></div>
    </form>`,
  );
  const st = statusLine(el);
  const form = el.querySelector('form')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const username = String(f.get('username')).trim();
    const password = String(f.get('password'));
    const problem = checkName(username) ?? checkPassword(password) ?? (password !== String(f.get('password2')) ? 'The two passwords are different.' : null);
    if (problem) return st.fail(new Error(problem));
    try {
      await a.cloud.ready((t) => st.busy(t));
      st.busy('Creating your account…');
      const recovery = await a.cloud.signup(username, password);
      // Unlocks earned on this device come along.
      if (loadUnlocks().ancient) await a.cloud.setProfile({ unlocks: loadUnlocks() }).catch(() => {});
      showRecoveryCode(root, a, recovery, true);
    } catch (err) {
      st.fail(err);
    }
  });
  el.querySelector('.back')!.addEventListener('click', () => showFront(root, a));
  el.querySelector<HTMLInputElement>('input')!.focus();
}

function showRecoveryCode(root: HTMLElement, a: FrontActions, code: string, isNew: boolean) {
  const el = screen(
    root,
    `<h2 class="atitle">${isNew ? 'Account created!' : 'Password changed!'}</h2>
    <p>Your recovery code:</p>
    <div class="rcode">${esc(code)}</div>
    <p class="warn">Write it down or take a photo of it, and keep it somewhere safe.<br>It's the only way to get back in if you forget your password. You won't see it again.</p>
    <div class="tbtns"><button class="primary ok">I saved my code</button></div>`,
  );
  el.querySelector('.ok')!.addEventListener('click', () => showSlots(root, a));
}

function showRecover(root: HTMLElement, a: FrontActions) {
  const el = screen(
    root,
    `<h2 class="atitle">Forgot your password?</h2>
    <form class="acct" novalidate>
      <label>Username <input name="username" autocomplete="username" maxlength="16" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <label>Recovery code <input name="recovery" class="codein" placeholder="XXXX-XXXX-XXXX-XXXX" maxlength="24" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <label>New password <input name="password" type="password" autocomplete="new-password" maxlength="128"></label>
      <div class="tbtns"><button class="primary" type="submit">Set new password</button><button type="button" class="back">Back</button></div>
      <div class="astatus"></div>
    </form>`,
  );
  const st = statusLine(el);
  const form = el.querySelector('form')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const problem = checkName(String(f.get('username')).trim()) ?? (String(f.get('recovery')).replace(/[^A-Za-z0-9]/g, '').length < 16 ? 'Type the whole recovery code (16 letters and numbers).' : null) ?? checkPassword(String(f.get('password')));
    if (problem) return st.fail(new Error(problem));
    try {
      await a.cloud.ready((t) => st.busy(t));
      st.busy('Checking your code…');
      const code = await a.cloud.recover(String(f.get('username')).trim(), String(f.get('recovery')), String(f.get('password')));
      showRecoveryCode(root, a, code, false);
    } catch (err) {
      st.fail(err);
    }
  });
  el.querySelector('.back')!.addEventListener('click', () => showLogin(root, a));
}

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
};
const played = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min played` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min played`);
const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : '');

function showSlots(root: HTMLElement, a: FrontActions) {
  const name = a.cloud.session?.username ?? '';
  const el = screen(
    root,
    `<h2 class="atitle">${esc(name)}'s heroes</h2>
    <div class="slotgrid"></div>
    <div class="astatus"></div>
    <div class="tbtns"><button class="back">Back</button></div>`,
  );
  const st = statusLine(el);
  const grid = el.querySelector<HTMLElement>('.slotgrid')!;
  el.querySelector('.back')!.addEventListener('click', () => showFront(root, a));
  if (!a.cloud.session) return showFront(root, a);

  const offline = loadSave();

  const render = (max: number, list: SlotInfo[]) => {
    const bySlot = new Map(list.map((s) => [s.slot, s]));
    grid.innerHTML = Array.from({ length: max }, (_, i) => {
      const s = bySlot.get(i);
      if (!s) {
        return `<div class="slotcard empty" data-slot="${i}">
          <div class="sname">Empty slot</div>
          <button class="primary new">New hero</button>
          ${offline ? `<button class="copy">Copy offline hero here<small>${esc(offline.character.name)}, level ${offline.character.level}</small></button>` : ''}
        </div>`;
      }
      const m = s.summary;
      const cls = CLASSES[m.classId as keyof typeof CLASSES]?.name ?? titleCase(m.classId);
      const race = RACES[m.raceId as keyof typeof RACES]?.name ?? titleCase(m.raceId);
      return `<div class="slotcard" data-slot="${i}">
        <div class="sname">${esc(m.name || 'Hero')}</div>
        <div class="sinfo">Level ${m.level} ${esc(cls)} · ${esc(race)}</div>
        <div class="smeta">${played(m.playTime)} · saved ${ago(s.updatedAt)}</div>
        <button class="primary play">Play</button>
        <button class="link del">Delete</button>
      </div>`;
    }).join('');
    grid.querySelectorAll<HTMLElement>('.slotcard').forEach((card) => {
      const slot = Number(card.dataset.slot);
      card.querySelector('.new')?.addEventListener('click', () => a.create(slot));
      card.querySelector('.copy')?.addEventListener('click', async () => {
        try {
          st.busy('Copying your offline hero…');
          await a.cloud.store(slot, offline!, 0);
          await refresh();
        } catch (err) {
          st.fail(err);
        }
      });
      card.querySelector('.play')?.addEventListener('click', () => play(slot));
      card.querySelector('.del')?.addEventListener('click', () => {
        const s = bySlot.get(slot)!;
        card.innerHTML = `<div class="sname">Delete ${esc(s.summary.name)}?</div><p class="warn">This can't be undone.</p>
          <button class="danger yes">Delete forever</button><button class="no">Keep</button>`;
        card.querySelector('.no')!.addEventListener('click', () => render(max, list));
        card.querySelector('.yes')!.addEventListener('click', async () => {
          try {
            st.busy('Deleting…');
            await a.cloud.remove(slot);
            await refresh();
          } catch (err) {
            st.fail(err);
          }
        });
      });
    });
  };

  const play = async (slot: number) => {
    try {
      st.busy('Loading your hero…');
      const { save, updatedAt } = await a.cloud.load(slot);
      // Progress that never reached the account (no internet at the time) is kept on the device that made it.
      const local = loadSave(a.cloud.localKey(slot));
      if (local && local.character.name === save.character.name && local.world.playTime > save.world.playTime + 30) {
        st.done();
        return chooseCopy(slot, local, save, updatedAt);
      }
      a.play(slot, save, updatedAt);
    } catch (err) {
      st.fail(err);
    }
  };

  const chooseCopy = (slot: number, local: SaveData, server: SaveData, version: number) => {
    const card = grid.querySelector<HTMLElement>(`.slotcard[data-slot="${slot}"]`)!;
    const extra = Math.round((local.world.playTime - server.world.playTime) / 60);
    card.innerHTML = `<div class="sname">${esc(local.character.name)}</div>
      <p class="warn">This device has ${extra || 'a few'} more minute${extra === 1 ? '' : 's'} of progress than your account (it couldn't upload in time).</p>
      <button class="primary mine">Use this device's</button><button class="theirs">Use the account's</button>`;
    card.querySelector('.mine')!.addEventListener('click', () => a.play(slot, local, version));
    card.querySelector('.theirs')!.addEventListener('click', () => a.play(slot, server, version));
  };

  const refresh = async () => {
    await a.cloud.ready((t) => st.busy(t));
    st.busy('Loading your heroes…');
    const { max, slots } = await a.cloud.slots();
    render(max, slots);
    st.done();
  };

  void (async () => {
    try {
      await refresh();
      // Unlocks follow the account: what either side has, both get.
      const profile = await a.cloud.profile();
      const local = loadUnlocks();
      if (profile.unlocks?.ancient && !local.ancient) saveUnlocks({ ...local, ancient: true });
      else if (local.ancient && !profile.unlocks?.ancient) await a.cloud.setProfile({ ...profile, unlocks: { ...profile.unlocks, ancient: true } });
    } catch (err) {
      if (err instanceof CloudError && err.code === 'signed-out') return showLogin(root, a);
      st.fail(err);
    }
  })();
}
