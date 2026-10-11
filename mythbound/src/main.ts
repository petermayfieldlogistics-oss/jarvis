import './styles.css';
import { Game } from './engine/game';
import { heightAt } from './engine/terrain';
import { deleteSave, loadSave, loadSettings, newWorldState, writeSave, type WorldState } from './engine/state';
import type { Character } from './rules/character';
import { showCreator, showTitle } from './ui/creator';

const app = document.getElementById('app')!;
let game: Game | null = null;

function title() {
  game?.stop();
  game = null;
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
    }, title),
  );
}

function start(character: Character, world: WorldState, fresh = false) {
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.innerHTML = '<div>Forging the world…</div>';
  app.appendChild(loading);
  // Let the loading text paint before the heavy world build.
  setTimeout(() => {
    const host = document.createElement('div');
    host.className = 'game';
    app.appendChild(host);
    game = new Game(host, character, world, loadSettings());
    game.onQuit = title;
    loading.remove();
    game.audio.unlock();
    game.start();
    if (fresh) game.story.intro();
  }, 50);
}

// Audio needs a user gesture.
window.addEventListener('pointerdown', () => game?.audio.unlock(), { once: false });

declare global {
  interface Window {
    mythbound?: { game: () => Game | null; height: (x: number, z: number) => number };
  }
}
window.mythbound = { game: () => game, height: heightAt };

title();
