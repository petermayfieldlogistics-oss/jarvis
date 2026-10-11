export interface DialogOption {
  label: string;
  action?: () => void;
  disabled?: boolean;
}

export interface DialogSpec {
  title: string;
  subtitle?: string;
  text: string;
  options?: DialogOption[];
  /** Corrupted, flickering text. */
  glitch?: boolean;
}

const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!);

/** Escapes text but keeps the <i> tags the Chronicler uses for edits. */
const rich = (s: string) => esc(s).replace(/&lt;(\/?)i&gt;/g, '<$1i>').replace(/\n/g, '<br>');

export class Dialog {
  isOpen = false;
  private el: HTMLElement;
  private version = 0;
  private onClose: (() => void) | null = null;
  private keyHandler = (e: KeyboardEvent) => {
    if (!this.isOpen) return;
    const n = Number(e.key);
    const buttons = Array.from(this.el.querySelectorAll<HTMLButtonElement>('.opts button:not([disabled])'));
    if (n >= 1 && n <= buttons.length) {
      e.stopImmediatePropagation();
      buttons[n - 1].click();
    }
    if (e.key === 'Escape' || (e.key === 'Enter' && buttons.length === 1)) {
      // Keep the game from also seeing this key (Escape opens the menu).
      e.stopImmediatePropagation();
      (buttons.length === 1 ? buttons[0] : buttons[buttons.length - 1])?.click();
    }
  };

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'dialog hidden';
    parent.appendChild(this.el);
    window.addEventListener('keydown', this.keyHandler, true);
  }

  open(spec: DialogSpec, onClose?: () => void) {
    this.version++;
    if (onClose) this.onClose = onClose;
    this.isOpen = true;
    const options = spec.options?.length ? spec.options : [{ label: 'Close' }];
    this.el.className = `dialog${spec.glitch ? ' glitch' : ''}`;
    this.el.innerHTML = `
      <div class="panel">
        <div class="dtitle">${esc(spec.title)}</div>
        ${spec.subtitle ? `<div class="dsub">${esc(spec.subtitle)}</div>` : ''}
        <div class="dtext">${rich(spec.text)}</div>
        <div class="opts"></div>
      </div>`;
    const box = this.el.querySelector('.opts')!;
    options.forEach((o, i) => {
      const b = document.createElement('button');
      b.innerHTML = `<span class="num">${i + 1}</span>${esc(o.label)}`;
      b.disabled = !!o.disabled;
      b.addEventListener('click', () => {
        const before = this.version;
        o.action?.();
        if (this.version === before) this.close();
      });
      box.appendChild(b);
    });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.className = 'dialog hidden';
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }
}
