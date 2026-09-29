// Desktop app (Windows / macOS / Linux): the same web app, packaged with Electron
// so it installs and runs locally. Pages are served from the app bundle over a
// private app:// scheme, which behaves like a normal secure website (camera,
// IndexedDB, web workers) without needing a web server.
import { app, BrowserWindow, net, protocol, session, shell, systemPreferences } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEME = 'app';
const HOST = 'card-scanner';
const APP_ORIGIN = `${SCHEME}://${HOST}`;
const DIST = path.join(app.getAppPath(), 'dist');

// Card-data sites the app talks to. If one of them doesn't send CORS headers
// (so a browser page may not read it), the desktop app adds them, so lookups
// and prices that could fail on the website still work here.
const API_URLS = [
  'https://api.tcgdex.net/*',
  'https://api.scryfall.com/*',
  'https://raw.githubusercontent.com/*',
  'https://optcgapi.com/*',
  'https://www.optcgapi.com/*',
  'https://db.ygoprodeck.com/*',
  'https://api.lorcast.com/*',
];

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function serveAppFiles() {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.normalize(path.join(DIST, rel));
    if (url.host !== HOST || !file.startsWith(DIST + path.sep)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

function allowCardApis() {
  session.defaultSession.webRequest.onHeadersReceived({ urls: API_URLS }, (details, callback) => {
    const headers = { ...details.responseHeaders };
    const has = Object.keys(headers).some((k) => k.toLowerCase() === 'access-control-allow-origin');
    if (!has) headers['Access-Control-Allow-Origin'] = ['*'];
    callback({ responseHeaders: headers });
  });
}

function allowCameraForTheApp() {
  const fromApp = (url) => typeof url === 'string' && url.startsWith(APP_ORIGIN);
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => permission === 'media' && fromApp(origin));
  session.defaultSession.setPermissionRequestHandler(async (_wc, permission, callback, details) => {
    if (permission !== 'media' || !fromApp(details.requestingUrl)) return callback(false);
    // macOS asks once, the first time the app wants the camera.
    if (process.platform === 'darwin') return callback(await systemPreferences.askForMediaAccess('camera'));
    callback(true);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 900,
    minWidth: 380,
    minHeight: 560,
    title: 'Card Scanner',
    backgroundColor: '#14161c',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });

  // Links to price sites open in the normal browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(APP_ORIGIN)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });

  void win.loadURL(`${APP_ORIGIN}/index.html`);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    serveAppFiles();
    allowCardApis();
    allowCameraForTheApp();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
