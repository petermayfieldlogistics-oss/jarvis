// Builds dist-single/Card-Scanner.html: the whole app, OCR engine included, in
// one file that works when opened straight from disk (double-click), with no
// web server, install or hosting.
import { readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-single');

process.env.VITE_SINGLE_FILE = '1';
await build({
  root,
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    // The public/ folder (served OCR files, service worker) isn't needed.
    copyPublicDir: false,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});

// Inline scripts must not contain "</script" or "<!--", which would end or
// confuse the <script> element. Both only occur inside strings here, where
// the escaped forms mean the same thing.
const safeScript = (code) => code.replaceAll('</script', '<\\/script').replaceAll('<!--', '<\\!--');

let html = readFileSync(join(outDir, 'index.html'), 'utf8');
const assets = join(outDir, 'assets');
for (const name of readdirSync(assets)) {
  const content = readFileSync(join(assets, name), 'utf8');
  if (name.endsWith('.js')) {
    const tag = new RegExp(`<script type="module" crossorigin src="\\./assets/${name.replace('.', '\\.')}"></script>`);
    if (!tag.test(html)) throw new Error(`Couldn't find the script tag for ${name}`);
    html = html.replace(tag, () => `<script type="module">${safeScript(content)}</script>`);
  } else if (name.endsWith('.css')) {
    const tag = new RegExp(`<link rel="stylesheet" crossorigin href="\\./assets/${name.replace('.', '\\.')}">`);
    if (!tag.test(html)) throw new Error(`Couldn't find the stylesheet tag for ${name}`);
    html = html.replace(tag, () => `<style>${content}</style>`);
  }
}
if (/src="\.\/assets\/|href="\.\/assets\//.test(html)) throw new Error('Some build files were not inlined');

// Icons as data URLs; the web-app manifest only matters for hosted installs.
const svgIcon = `data:image/svg+xml;base64,${readFileSync(join(root, 'public/icon.svg')).toString('base64')}`;
const pngIcon = `data:image/png;base64,${readFileSync(join(root, 'public/icon-192.png')).toString('base64')}`;
html = html
  .replace('href="./icon.svg"', `href="${svgIcon}"`)
  .replace('href="./icon-192.png"', `href="${pngIcon}"`)
  .replace(/\s*<link rel="manifest"[^>]*>/, '');

const target = join(outDir, 'Card-Scanner.html');
writeFileSync(target, html);
rmSync(join(outDir, 'index.html'));
rmSync(assets, { recursive: true });
console.log(`Built ${target} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB)`);
