// Keyboard + mouse and touch controls, mapped onto the same actions.

import { STICK, stickMove } from '../rules/touch';

export type Action =
  | 'attack' | 'heavy' | 'block' | 'roll' | 'jump' | 'sprint' | 'interact' | 'cast' | 'ability' | 'lock'
  | 'heal' | 'eat' | 'swap' | 'combine' | 'map' | 'menu' | 'crouch' | 'fly' | 'nextSpell' | 'shiftlock' | 'quests' | 'horse'
  | 'slot1' | 'slot2' | 'slot3' | 'slot4';

/** Releasing Shift sooner than this toggles shift lock; holding it longer sprints. */
const SHIFT_TAP_MS = 220;

// Ctrl is deliberately unbound: Ctrl+W closes the browser tab.
const KEYS: Record<string, Action> = {
  KeyE: 'heavy',
  Space: 'jump',
  KeyF: 'interact',
  KeyQ: 'cast',
  KeyR: 'ability',
  Tab: 'lock',
  KeyH: 'heal',
  KeyX: 'eat',
  KeyT: 'swap',
  KeyG: 'combine',
  KeyM: 'map',
  KeyJ: 'quests',
  Escape: 'menu',
  KeyI: 'menu',
  KeyC: 'roll',
  KeyZ: 'crouch',
  KeyV: 'fly',
  KeyB: 'horse',
  Digit1: 'slot1',
  Digit2: 'slot2',
  Digit3: 'slot3',
  Digit4: 'slot4',
};

/** Radians the camera turns per pixel a finger drags. */
const TOUCH_LOOK = 0.0085;

export class Input {
  move = { x: 0, y: 0 };
  look = { dx: 0, dy: 0 };
  held = new Set<Action>();
  pressed = new Set<Action>();
  released = new Set<Action>();
  wheel = 0;
  touch = false;
  enabled = true;
  sensitivity = 1;
  invertY = false;
  private keys = new Set<string>();
  private shiftDownAt = -1;
  /** Another key or button was pressed while Shift was down (Shift+W is a sprint, not a tap). */
  private shiftChorded = false;
  private stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private lookTouch = { id: -1, x: 0, y: 0 };
  /** When a finger last turned the camera (performance.now ms): the camera doesn't follow the hero for a moment after. */
  lookedAt = -1e9;
  private touchRoot: HTMLElement | null = null;
  /** Mirrors the camera's shift lock (set by the player). */
  shiftLock = false;
  pointerLocked = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.reset());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this.shiftChorded = true;
      this.requestLock();
      if (e.button === 0) this.down('attack');
      if (e.button === 2) this.down('block');
      if (e.button === 1) this.down('lock');
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.up('attack');
      if (e.button === 2) this.up('block');
      if (e.button === 1) this.up('lock');
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => (this.pointerLocked = document.pointerLockElement === canvas));
    window.addEventListener('mousemove', (e) => {
      // Without a captured pointer, only dragging turns the camera, so a free cursor never steers on its own.
      if ((this.pointerLocked || (e.buttons & 1 && !this.touch)) && this.enabled) {
        this.look.dx += e.movementX * 0.0025 * this.sensitivity;
        this.look.dy += e.movementY * 0.0025 * this.sensitivity * (this.invertY ? -1 : 1);
      }
    });
    canvas.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
    this.touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches;
  }

  /** Captures the mouse so it turns the camera. Some browsers and embedded views refuse; dragging still works then. */
  requestLock() {
    if (this.pointerLocked || this.touch) return;
    try {
      (this.canvas.requestPointerLock?.() as Promise<void> | undefined)?.catch?.(() => {});
    } catch {
      /* ignore */
    }
  }

  private onKey(e: KeyboardEvent, isDown: boolean) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'Tab') e.preventDefault();
    if (isDown && e.repeat) return;
    if (isDown) this.keys.add(e.code);
    else this.keys.delete(e.code);
    // Shift: tap to toggle shift lock, hold to sprint.
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      if (isDown) {
        this.shiftDownAt = performance.now();
        this.shiftChorded = false;
        this.down('sprint');
      } else {
        this.up('sprint');
        const tap = this.shiftDownAt >= 0 && performance.now() - this.shiftDownAt < SHIFT_TAP_MS && !this.shiftChorded;
        this.shiftDownAt = -1;
        if (tap && this.enabled) {
          this.tap('shiftlock');
          // Still inside the key gesture, so the browser lets us capture the mouse.
          this.requestLock();
        }
      }
      return;
    }
    if (isDown) this.shiftChorded = true;
    const action = KEYS[e.code];
    if (!action) return;
    if (isDown) this.down(action);
    else this.up(action);
  }

  private down(a: Action) {
    if (!this.held.has(a)) this.pressed.add(a);
    this.held.add(a);
  }
  private up(a: Action) {
    if (this.held.has(a)) this.released.add(a);
    this.held.delete(a);
  }
  tap(a: Action) {
    this.pressed.add(a);
    this.released.add(a);
  }

  reset() {
    this.keys.clear();
    this.held.clear();
    this.shiftDownAt = -1;
    this.move.x = this.move.y = 0;
  }

  /** Call once per frame before reading. */
  poll() {
    if (!this.touch || this.stick.id < 0) {
      let x = 0, y = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
      const l = Math.hypot(x, y) || 1;
      this.move.x = x / l;
      this.move.y = y / l;
    }
    if (!this.enabled) {
      this.move.x = this.move.y = 0;
      this.held.clear();
    }
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.look.dx = this.look.dy = 0;
    this.wheel = 0;
  }

  // ---------------------------------------------------------------- touch --

  /** Builds the on-screen controls. `labels` lets the game rename buttons. */
  buildTouch(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'touch';
    root.innerHTML = `
      <div class="stick"><div class="knob"></div></div>
      <div class="tpad">
        <button data-a="attack" class="big">⚔</button>
        <button data-a="roll">⤿</button>
        <button data-a="heavy">💥</button>
        <button data-a="jump">⤒</button>
        <button data-a="block">🛡</button>
        <button data-a="cast">✦</button>
        <button data-a="ability">❂</button>
        <button data-a="heal">⚗</button>
      </div>
      <div class="tbar">
        <button data-a="shiftlock">🔒</button>
        <button data-a="lock">◎</button>
        <button data-a="swap">⇄</button>
        <button data-a="crouch">▼</button>
        <button data-a="fly">🪽</button>
        <button data-a="horse">🐎</button>
        <button data-a="combine">⊕</button>
        <button data-a="eat">🐟</button>
        <button data-a="map">🗺</button>
        <button data-a="menu">☰</button>
      </div>
      <button class="tinteract" data-a="interact">F</button>`;
    parent.appendChild(root);
    this.touchRoot = root;
    for (const b of root.querySelectorAll<HTMLButtonElement>('button[data-a]')) {
      const a = b.dataset.a as Action;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.down(a);
        b.classList.add('on');
      }, { passive: false });
      const end = (e: Event) => {
        e.preventDefault();
        this.up(a);
        b.classList.remove('on');
      };
      b.addEventListener('touchend', end);
      b.addEventListener('touchcancel', end);
    }
    const stick = root.querySelector<HTMLElement>('.stick')!;
    const knob = root.querySelector<HTMLElement>('.knob')!;
    const zone = this.canvas;
    const place = () => {
      stick.style.left = `${this.stick.ox - 60}px`;
      stick.style.top = `${this.stick.oy - 60}px`;
    };
    zone.addEventListener('touchstart', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        // The stick: anywhere on the lower left (the top of the screen turns the camera, even on the left).
        const w = window.innerWidth, h = window.innerHeight;
        if (t.clientX < w * (w < h ? 0.5 : 0.45) && t.clientY > h * 0.3 && this.stick.id < 0) {
          this.stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
          place();
          stick.classList.add('active');
        } else if (this.lookTouch.id < 0) {
          this.lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.stick.id) {
          let dx = t.clientX - this.stick.ox;
          let dy = t.clientY - this.stick.oy;
          let l = Math.hypot(dx, dy);
          // A thumb that wanders far off drags the stick along, so it never runs out of reach.
          if (l > STICK.drag) {
            this.stick.ox = t.clientX - (dx * STICK.drag) / l;
            this.stick.oy = t.clientY - (dy * STICK.drag) / l;
            place();
            (dx = t.clientX - this.stick.ox), (dy = t.clientY - this.stick.oy), (l = STICK.drag);
          }
          const kl = Math.min(l, 50);
          knob.style.transform = `translate(${(dx * kl) / Math.max(l, 1e-6)}px, ${(dy * kl) / Math.max(l, 1e-6)}px)`;
          // A small dead zone (a resting thumb doesn't creep), full running speed well
          // inside the ring; sprinting only when the thumb is pushed past it.
          const m = stickMove(dx, dy);
          this.move.x = m.x;
          this.move.y = m.y;
          if (l > STICK.sprint) this.held.add('sprint');
          else if (l < STICK.walk) this.held.delete('sprint');
          stick.classList.toggle('sprint', this.held.has('sprint'));
        } else if (t.identifier === this.lookTouch.id) {
          this.look.dx += (t.clientX - this.lookTouch.x) * TOUCH_LOOK * this.sensitivity;
          this.look.dy += (t.clientY - this.lookTouch.y) * TOUCH_LOOK * this.sensitivity * (this.invertY ? -1 : 1);
          this.lookTouch.x = t.clientX;
          this.lookTouch.y = t.clientY;
          this.lookedAt = performance.now();
        }
      }
      e.preventDefault();
    }, { passive: false });
    const endTouch = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.stick.id) {
          this.stick.id = -1;
          this.move.x = this.move.y = 0;
          this.held.delete('sprint');
          knob.style.transform = '';
          stick.classList.remove('active', 'sprint');
        } else if (t.identifier === this.lookTouch.id) {
          this.lookTouch.id = -1;
          this.lookedAt = performance.now();
        }
      }
    };
    zone.addEventListener('touchend', endTouch);
    zone.addEventListener('touchcancel', endTouch);
  }

  /** A finger is turning the camera now. */
  get looking() {
    return this.lookTouch.id >= 0;
  }

  /** Lights the touch shift-lock button while shift lock is on. */
  setShiftLock(on: boolean) {
    this.shiftLock = on;
    this.touchRoot?.querySelector<HTMLElement>('button[data-a="shiftlock"]')?.classList.toggle('lit', on);
  }

  setTouchVisible(v: boolean) {
    if (this.touchRoot) this.touchRoot.style.display = v ? '' : 'none';
  }

  private interactLabel: string | null | undefined;
  /** Shows the interact button only when there is something to interact with. */
  setInteract(label: string | null) {
    if (label === this.interactLabel) return;
    this.interactLabel = label;
    const b = this.touchRoot?.querySelector<HTMLElement>('.tinteract');
    if (!b) return;
    // The stylesheet hides it by default, so it has to be shown explicitly.
    b.classList.toggle('show', !!label);
    b.textContent = '✋';
    b.title = label ?? '';
  }

  /** Hides touch buttons the hero can't use. */
  setTouchButtons(enabled: Partial<Record<Action, boolean>>) {
    if (!this.touchRoot) return;
    for (const b of this.touchRoot.querySelectorAll<HTMLElement>('button[data-a]')) {
      const a = b.dataset.a as Action;
      if (a in enabled) b.style.display = enabled[a] ? '' : 'none';
    }
  }
}
