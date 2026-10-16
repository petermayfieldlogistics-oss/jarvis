// What player-versus-player puts on screen: a challenge to answer, the
// countdown, the scoreboard, who felled whom, and the results.

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export interface ScoreRow {
  name: string;
  kills: number;
  deaths: number;
  /** Team colour (CSS), or '' in a free-for-all. */
  color: string;
  me: boolean;
}

export class PvpHud {
  private root: HTMLElement;
  private askEl: HTMLElement;
  private countEl: HTMLElement;
  private scoreEl: HTMLElement;
  private feedEl: HTMLElement;
  private resultEl: HTMLElement;
  private downEl: HTMLElement;
  private countTimer = 0;
  private resultTimer = 0;
  private scoreKey = '';
  private onYes: (() => void) | null = null;
  private onNo: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'pvp';
    root.innerHTML = `
      <div class="pvp-ask"><div class="pq"></div><div class="pbtns"><button class="py"></button><button class="pn"></button></div></div>
      <div class="pvp-count"></div>
      <div class="pvp-score"></div>
      <div class="pvp-feed"></div>
      <div class="pvp-down"></div>
      <div class="pvp-result"></div>`;
    parent.appendChild(root);
    this.root = root;
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    this.askEl = q('.pvp-ask');
    this.countEl = q('.pvp-count');
    this.scoreEl = q('.pvp-score');
    this.feedEl = q('.pvp-feed');
    this.resultEl = q('.pvp-result');
    this.downEl = q('.pvp-down');
    // Buttons answer on a tap or a click (pointerdown, so a locked mouse pointer or a phone both work).
    const press = (e: Event, yes: boolean) => {
      e.preventDefault();
      e.stopPropagation();
      const f = yes ? this.onYes : this.onNo;
      this.closeAsk();
      f?.();
    };
    q('.py').addEventListener('pointerdown', (e) => press(e, true));
    q('.pn').addEventListener('pointerdown', (e) => press(e, false));
    this.resultEl.addEventListener('pointerdown', () => this.closeResult());
  }

  /** A question with two answers (a duel challenge, a match invitation); a new one replaces it. */
  ask(text: string, yes: string, no: string, onYes: () => void, onNo: () => void) {
    (this.askEl.querySelector('.pq') as HTMLElement).textContent = text;
    (this.askEl.querySelector('.py') as HTMLElement).textContent = yes;
    (this.askEl.querySelector('.pn') as HTMLElement).textContent = no;
    this.onYes = onYes;
    this.onNo = onNo;
    this.askEl.classList.add('show');
  }

  closeAsk() {
    this.askEl.classList.remove('show');
    this.onYes = this.onNo = null;
  }

  get asking() {
    return this.askEl.classList.contains('show');
  }

  /** A big number (or FIGHT!) in the middle of the screen. */
  countdown(text: string, go = false) {
    this.countEl.textContent = text;
    this.countEl.className = 'pvp-count';
    void this.countEl.offsetWidth;
    this.countEl.className = `pvp-count show${go ? ' go' : ''}`;
    this.countTimer = go ? 1.1 : 0.9;
  }

  /** The bar across the top: a duel's foe, or a match's score and clock (null hides it). */
  score(title: string | null, rows: ScoreRow[] = [], clock = '') {
    if (title === null) {
      if (this.scoreKey) {
        this.scoreEl.classList.remove('show');
        this.scoreKey = '';
      }
      return;
    }
    const key = `${title}|${clock}|${rows.map((r) => `${r.name}${r.kills}/${r.deaths}${r.color}`).join(',')}`;
    if (key === this.scoreKey) return;
    this.scoreKey = key;
    this.scoreEl.innerHTML = `<div class="ptitle">${title}</div>${clock ? `<div class="pclock">${esc(clock)}</div>` : ''}${rows.length
      ? `<ol>${rows.map((r) => `<li class="${r.me ? 'me' : ''}"${r.color ? ` style="--tc:${r.color}"` : ''}><b>${esc(r.name)}</b><span>${r.kills} ⚔ ${r.deaths} ☠</span></li>`).join('')}</ol>`
      : ''}`;
    this.scoreEl.classList.add('show');
  }

  /** Who felled whom, for a few seconds at the side. */
  feed(killer: string | null, victim: string, mine: boolean) {
    const el = document.createElement('div');
    el.className = `pf${mine ? ' mine' : ''}`;
    el.innerHTML = killer ? `<b>${esc(killer)}</b> ⚔ ${esc(victim)}` : `${esc(victim)} fell`;
    this.feedEl.prepend(el);
    while (this.feedEl.children.length > 5) this.feedEl.lastElementChild!.remove();
    setTimeout(() => el.classList.add('out'), 4500);
    setTimeout(() => el.remove(), 5200);
  }

  /** The end of a duel or match: VICTORY, DEFEAT or DRAW, and what it brought. */
  result(title: string, kind: 'win' | 'loss' | 'draw', lines: string[], seconds = 6) {
    this.resultEl.className = `pvp-result show ${kind}`;
    this.resultEl.innerHTML = `<div class="rt">${esc(title)}</div>${lines.map((l) => `<div class="rl">${esc(l)}</div>`).join('')}`;
    this.resultTimer = seconds;
  }

  closeResult() {
    this.resultEl.className = 'pvp-result';
    this.resultTimer = 0;
  }

  /** "Back in 3…" while a fallen hero waits to rise (null hides it). */
  down(text: string | null) {
    if (text === null) this.downEl.classList.remove('show');
    else {
      this.downEl.textContent = text;
      this.downEl.classList.add('show');
    }
  }

  update(dt: number) {
    if (this.countTimer > 0 && (this.countTimer -= dt) <= 0) this.countEl.className = 'pvp-count';
    if (this.resultTimer > 0 && (this.resultTimer -= dt) <= 0) this.closeResult();
  }

  dispose() {
    this.root.remove();
  }
}
