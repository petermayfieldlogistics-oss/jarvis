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

The workflow in `.github/workflows/deploy-card-scanner.yml` builds and publishes the app
whenever `card-scanner/` changes on `main`. One-time setup:

1. On GitHub, open the repo's **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main` (or run the workflow from the **Actions** tab).

The app is then live at `https://<your-user-or-org>.github.io/<repo>/`. Open it on your
phone and choose **Add to Home Screen**. Anyone with the link can use it, and each
person's collection is stored in their own browser.

## Project layout

```
src/
  ocr/          camera/photo → cropped card → text → parsed hints
  games/        one provider per game: identify(hints), search(text), refresh(prices)
  lib/          collection maths, CSV/JSON export, storage, HTTP helpers
  components/   Scanner, SearchPanel, CollectionView and shared UI
scripts/copy-ocr-assets.mjs   copies the Tesseract engine + English data into public/ocr
```

Adding another game means writing one more file in `src/games/` that implements
`GameProvider`, plus a parser for its printed code in `src/ocr/parse.ts`.
