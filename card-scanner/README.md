# Card Scanner

A free trading card scanner and collection tracker that runs in your phone's browser.
It covers **Pokémon**, **One Piece**, **Magic: The Gathering**, **Marvel** (Magic's
Marvel sets), **Yu-Gi-Oh!** and **Disney Lorcana**. There are no accounts,
subscriptions or ads, and nothing gets uploaded: the camera image is read on your device.

## What it does

- **Scan with the camera.** Line the card up in the frame and tap the button. The app
  reads the printed card code and the card name, then looks the card up. Codes it reads:
  One Piece `OP01-013`, Pokémon `025/198`, Magic `0149 C · M11 • EN`, Yu-Gi-Oh! set
  code `LOB-EN001` and passcode `89631139`, Lorcana `42/204 • EN • 1`.
- **Scan a photo** from your camera roll if live camera access isn't available.
- **Search by name** (or by One Piece card id, Yu-Gi-Oh! set code or passcode) when a scan can't read the card.
- **Honest guesses.** If no card code could be read, the result says "Possible match"
  and ranks answers from every game by how well the name fits.
- **Pick the right printing.** Every alternate art and reprint is listed, each with its own price.
- **Track your collection.** Record quantity, foil/holo and condition, see the total
  value, filter by game, and sort by value, name, set or date added.
- **Update prices** with one tap.
- **Back up and export.** Save a JSON backup (restore it on another device) or export
  a CSV spreadsheet.
- **Install it like an app.** Use "Add to Home Screen" and it opens full-screen and works offline.

## Where the data comes from (all free, no API keys)

| Game | Card data | Prices |
| --- | --- | --- |
| Pokémon | [TCGdex](https://tcgdex.dev) | TCGplayer (USD) and Cardmarket (EUR), via TCGdex |
| Magic / Marvel | [Scryfall](https://scryfall.com/docs/api) | TCGplayer (USD) and Cardmarket (EUR), via Scryfall |
| One Piece | [Punk Records](https://github.com/buhbbl/punk-records), built from the official card list | TCGplayer, via [OPTCG API](https://optcgapi.com) |
| Yu-Gi-Oh! | [YGOPRODeck](https://ygoprodeck.com/api-guide/) | TCGplayer (per printing where available) and Cardmarket, via YGOPRODeck |
| Lorcana | [Lorcast](https://lorcast.com/docs/api) | TCGplayer (USD, normal and foil), via Lorcast |

YGOPRODeck asks apps not to keep re-downloading card images from its servers, so the
service worker saves each Yu-Gi-Oh! image on the device the first time it's shown.

Prices are market estimates, not offers. For anything valuable, check recent sales before you buy or sell.

## How scanning works

1. The camera frame is cropped to the card outline and scaled to a fixed size.
2. The bottom strip (card number / set code), the top strip (name) and, for
   Yu-Gi-Oh!, the strip under the artwork (set code) are cleaned up
   (greyscale, contrast, and white text flipped to dark) and read with
   [Tesseract](https://github.com/naptha/tesseract.js). Tesseract runs in the browser
   as WebAssembly, and its files are served by this site rather than a CDN.
3. `src/ocr/parse.ts` pulls the codes and name out of that text. It fixes common
   OCR mix-ups such as `O`→`0` and `I`→`1`, and uses copyright lines and keywords
   to guess the game.
4. The game's data source is queried for matches (`src/games/*.ts`), and you choose the right one.

Tips for better scans: fill the frame with the card, keep the bottom edge sharp,
avoid glare on foils, and pick the game with the chips at the top.

## Running it yourself

```bash
cd card-scanner
npm install
npm run dev        # http://localhost:5173 — camera works on localhost
npm test           # unit tests
npm run build      # production build in dist/
```

To use the camera on a phone the page needs HTTPS. The GitHub Pages deployment
below provides it.

## Putting it online for free (GitHub Pages)

The workflow in `.github/workflows/deploy-card-scanner.yml` tests every change and
publishes the app whenever `card-scanner/` changes on the repository's default branch.
One-time setup:

1. On GitHub, open the repo's **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Run the **Deploy Card Scanner** workflow from the **Actions** tab (or push a change).

The app is then live at `https://<your-user-or-org>.github.io/<repo>/`. Anyone with the
link can use it, and each person's collection is stored in their own browser.

### Installing it on a phone

- **iPhone:** open the link in **Safari**, tap **Share**, then **Add to Home Screen**.
- **Android:** open the link in **Chrome**, tap the **⋮** menu, then **Install app** (or
  **Add to Home screen**).

The first scan downloads the text-recognition engine (about 7 MB); after that it's cached.

## Single-file version (no install, no hosting)

`npm run build:single` makes `dist-single/Card-Scanner.html`: the whole app, with its
text-recognition engine, in one ~8 MB file. Save it on a computer and double-click it to
open it in the browser. It needs internet only to look up cards and prices. Your
collection is saved in that browser. On a Mac, if the camera won't start in Safari, open the
file in Chrome or use **Scan a photo**. Phones and iPads can't run a downloaded file like
this; use the hosted version or the apps below.

## Desktop and iPhone apps

GitHub builds installable apps on every change (`.github/workflows/build-apps.yml`) and
puts the newest ones on the
[**apps-latest** release page](https://github.com/petermayfieldlogistics-oss/jarvis/releases/tag/apps-latest).
The apps run entirely on your device, and your collection is saved there too.

### Windows

1. Download `Card-Scanner-win-x64.exe` and run it.
2. If Windows says "Windows protected your PC", click **More info → Run anyway**.
   The app isn't code-signed, because a signing certificate costs money.

### Mac

1. Download `Card-Scanner-mac-arm64.dmg` for an Apple-silicon Mac (M1 or later), or
   `Card-Scanner-mac-x64.dmg` for an Intel Mac.
2. Open it and drag **Card Scanner** into **Applications**.
3. The first time you open it, macOS says it can't check the app. Go to **System Settings →
   Privacy & Security**, scroll down, and click **Open Anyway**. (Apple charges $99 a year
   to remove that step.)
4. Allow camera access when asked. You can also scan photos or use the webcam.

### Linux

Download `Card-Scanner-linux-x86_64.AppImage`, run `chmod +x` on it, then open it.

### iPhone

Apple only lets you install apps from outside the App Store if they're signed with your
Apple ID. The free way to do that needs a Windows PC or a Mac:

1. On the computer, download `Card-Scanner-iOS-unsigned.ipa` and install
   [Sideloadly](https://sideloadly.io). On Windows, also install iTunes and iCloud from
   Apple's website (not the Microsoft Store versions).
2. Plug in the iPhone, drag the `.ipa` into Sideloadly, enter your Apple ID and click **Start**.
3. On the iPhone, turn on **Settings → Privacy & Security → Developer Mode** (the phone
   restarts). Then trust your Apple ID under **Settings → General → VPN & Device Management**.
4. With a free Apple ID, the app stops opening after **7 days** and must be installed
   again. Your collection is normally kept, but save a backup first.
   [AltStore](https://altstore.io) can renew it automatically while your computer is on
   the same Wi-Fi. A paid Apple Developer account ($99 a year) makes it last a year.

If that's too much hassle, the home-screen version (see "Installing it on a phone"
above) does the same job with no computer and no renewals.

### Building them yourself

```bash
npm run desktop        # run the desktop app
npm run dist:desktop   # build installers for the current OS into release/
npm run ios            # build and copy into ios/, then open ios/App/App.xcodeproj in Xcode (Mac only)
```

## Project layout

```
desktop/main.js   Electron wrapper for the desktop app
ios/              Capacitor iPhone project (open ios/App/App.xcodeproj in Xcode)
src/
  ocr/          camera/photo → cropped card → text → parsed hints
  games/        one provider per game: identify(hints), search(text), refresh(prices)
  lib/          collection maths, CSV/JSON export, storage, HTTP helpers
  components/   Scanner, SearchPanel, CollectionView and shared UI
scripts/copy-ocr-assets.mjs   copies the Tesseract engine + English data into public/ocr
```

Adding another game means writing one more file in `src/games/` that implements
`GameProvider`, plus a parser for its printed code in `src/ocr/parse.ts`.
