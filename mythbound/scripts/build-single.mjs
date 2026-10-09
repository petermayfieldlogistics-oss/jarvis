// Builds dist-single/Mythbound.html: the whole game in one file that runs
// when opened straight from disk, with no web server or install.
import { readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-single');

await build({
  root,
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    copyPublicDir: false,
    modulePreload: false,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});

// Inline scripts must not contain "</script" or "<!--".
const safeScript = (code) => code.replaceAll('</script', '<\\/script').replaceAll('<!--', '<\\!--');

let html = readFileSync(join(outDir, 'index.html'), 'utf8');
const assets = join(outDir, 'assets');
for (const name of readdirSync(assets)) {
  const content = readFileSync(join(assets, name), 'utf8');
  const escaped = name.replaceAll('.', '\\.');
  if (name.endsWith('.js')) {
    const tag = new RegExp(`<script type="module" crossorigin src="\\./assets/${escaped}"></script>`);
    if (!tag.test(html)) throw new Error(`Couldn't find the script tag for ${name}`);
    // Run the game after the body exists, since the script is now inline in <head>.
    html = html.replace(tag, '');
    html = html.replace('</body>', () => `<script type="module">${safeScript(content)}</script>\n  </body>`);
  } else if (name.endsWith('.css')) {
    const tag = new RegExp(`<link rel="stylesheet" crossorigin href="\\./assets/${escaped}">`);
    if (!tag.test(html)) throw new Error(`Couldn't find the stylesheet tag for ${name}`);
    html = html.replace(tag, () => `<style>${content}</style>`);
  }
}
if (/src="\.\/assets\/|href="\.\/assets\//.test(html)) throw new Error('Some build files were not inlined');

const target = join(outDir, 'Mythbound.html');
writeFileSync(target, html);
rmSync(join(outDir, 'index.html'));
rmSync(assets, { recursive: true });
console.log(`Built ${target} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
