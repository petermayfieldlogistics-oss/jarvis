import './styles.css';
import { Game } from './engine/game';
import { heightAt } from './engine/terrain';
import { Cloud, SlotSync } from './engine/cloud';
import { DEFAULT_SERVER } from './engine/net';
import { inviteCode } from './rules/invite';
import { deleteSave, loadSave, loadSettings, loadUnlocks, newWorldState, writeSave, type WorldState } from './engine/state';
import type { Character } from './rules/character';
import { showFront } from './ui/account';
import { showCreator, showTitle } from './ui/creator';

const app = document.getElementById('app')!;
let game: Game | null = null;
/** Uploads the hero's saves when playing from an account slot. */
let sync: SlotSync | null = null;
const cloud = new Cloud(() => loadSettings().coopServer);
/** A co-op room from an invite link (`?join=CODE`), joined as soon as a hero is picked. */
let invite = inviteCode(location.search);

function stopGame() {
  sync?.dispose();
  sync = null;
  game?.stop();
  game = null;
}

/** The front screen: log in, your account's heroes, or play offline. */
function title() {
  stopGame();
  app.innerHTML = '';
  showFront(app, {
    cloud,
    invite,
    offline: offlineTitle,
    play: (slot, save, version) => start(save.character, save.world, false, { slot, version }),
    create: (slot) => {
      app.innerHTML = '';
      showCreator(app, (c) => start(c, newWorldState(), true, { slot, version: 0 }), title);
    },
  });
}

/** The single hero kept on this device without an account. */
function offlineTitle() {
  app.innerHTML = '';
  const save = loadSave();
  showTitle(
    app,
    !!save,
    () => save && start(save.character, save.world),
    () => showCreator(app, (c) => {
      deleteSave();
      const world = newWorldState();
      writeSave({ character: c, world });
      start(c, world, true);
    }, offlineTitle),
    title,
  );
}

function start(character: Character, world: WorldState, fresh = false, slot?: { slot: number; version: number }) {
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.innerHTML = '<div>Forging the world…</div>';
  app.appendChild(loading);
  // Let the loading text paint before the heavy world build.
  setTimeout(() => {
    const host = document.createElement('div');
    host.className = 'game';
    app.appendChild(host);
    const g = new Game(host, character, world, loadSettings());
    game = g;
    g.onQuit = title;
    if (slot && cloud.session) {
      g.storeKey = cloud.localKey(slot.slot);
      g.accountName = cloud.session.username;
      sync = new SlotSync(cloud, slot.slot, slot.version, (text, kind) => g.hud.toast(text, kind));
      g.onSaved = (data) => sync?.push(data);
      g.onUnlock = () => void cloud.setProfile({ unlocks: loadUnlocks() }).catch(() => {});
      // A new hero claims its slot at once.
      if (fresh) g.save();
    }
    loading.remove();
    g.audio.unlock();
    g.start();
    if (fresh) g.story.intro();
    if (invite) joinInvite(g, invite);
  }, 50);
}

/** Takes the hero into the room an invite link named (once: quitting to the title doesn't rejoin). */
function joinInvite(g: Game, room: string) {
  invite = null;
  history.replaceState(history.state, '', location.pathname + location.hash);
  g.hud.toast(`Joining co-op room ${room}…`, 'skill');
  const name = g.settings.coopName || g.accountName || g.player.c.name;
  void g.coop.join(g.settings.coopServer || DEFAULT_SERVER, room, name).then(() => {
    // A server that can't be reached says so only in the co-op menu; say it here too.
    if (game === g && !g.coop.active && !g.coop.busy && g.coop.status) g.hud.toast(g.coop.status, 'warn');
  });
}

// Audio needs a user gesture (iOS only counts touchend and click for touch).
for (const type of ['pointerdown', 'touchend', 'click']) window.addEventListener(type, () => game?.audio.unlock(), { capture: true, passive: true });

declare global {
  interface Window {
    mythbound?: { game: () => Game | null; height: (x: number, z: number) => number; cloud: Cloud };
  }
}
window.mythbound = { game: () => game, height: heightAt, cloud };

title();
