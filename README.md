# TikTok Presenter

Vertical (9:16, 1080 × 1920) slides for TikTok LIVE through OBS Studio. OBS shows the
**Presentation View**, the slide and nothing else. You run the show from the
**Presenter View** in your browser, and the broadcast follows every click at once,
with no refresh.

It runs only on your Mac: no internet, no accounts, and no packages to install
beyond Node.js.

## Your slides are folders

```
slides/
  religion/                ← a topic (the folder name is the topic's name)
    01-world-religions.webp
    02-christianity.webp
    …
  another-topic/
```

- **One folder per topic** inside `slides/`. Name it in lowercase with dashes
  (`world-history`); the app shows it as "World History".
- **One image per slide**: PNG, JPG or WebP, ideally 1080 × 1920. Other sizes are
  fitted inside the frame on black, never stretched.
- **Order.** New files are shown in name order, so `01-…`, `02-…` works. Once you
  drag slides into another order in the Presenter View, that order is saved in the
  folder's hidden `.order.json`, and files added later go at the end.
- You can add, rename or delete images in Finder while the app runs; the Presenter
  View updates by itself.
- **Removed slides** are moved to `removed/<topic>/`, never deleted. To put one back,
  move it into its topic folder again.

`slides/religion/` holds seven sample slides. Replace them with your own.

## Start it

Double-click **`Start TikTok Presenter.command`**. A Terminal window opens and the
Presenter View opens in your browser at <http://localhost:7272/presenter>.
Keep the Terminal window open while you stream; close it (or press Ctrl+C) to stop.

The first time, macOS may say it can't verify the file. Right-click it, choose
**Open**, then **Open** again. After that a double-click works.

From a terminal instead:

```bash
cd ~/sites/tiktok-presenter && npm start
```

Requires Node.js 20 or newer (`node -v`).

## Connect OBS (once)

1. In OBS, set the canvas to vertical: **Settings → Video**, Base and Output
   resolution **1080x1920**.
2. In your scene, **Sources → + → Browser**, name it "Slides".
3. Set:
   - **URL:** `http://localhost:7272/present`
   - **Width:** `1080`, **Height:** `1920`
   - Turn **off** "Shutdown source when not visible", so the slides keep up while
     you switch scenes.
   - Leave "Refresh browser when scene becomes active" off.
4. Click **OK**. The current slide appears; fit it to the canvas with
   **right-click → Transform → Fit to screen** if needed.

OBS keeps this source between sessions. If you start OBS before the app, the
source shows black and picks up the slide by itself within a second of the app
starting.

## During the stream

| Do this                                 | How                                              |
| --------------------------------------- | ------------------------------------------------ |
| Next / previous slide                   | → / ← (also ↓ / ↑, Page Down / Up, or a clicker), or the buttons |
| Jump to a slide                         | Click its thumbnail                              |
| Switch topic                            | Click the topic on the left (starts at slide 1)  |
| Add slides                              | **Import images**, or drop files on the slides   |
| Reorder                                 | Drag a thumbnail                                 |
| Remove                                  | Hover a thumbnail, click ×                       |
| New topic                               | Type a name under the topics, click **Add**      |

The broadcast fades between slides only once the next image is fully loaded, so it
never shows a blank frame. If the app stops, OBS keeps showing the last slide and
reconnects when you start it again. The app remembers the topic and slide you were
on.

The Presenter View works best in a window at least 1000 px wide. You can also
preview the broadcast in a browser with the sidebar's **Open** button.

## Settings

Set before starting, for example `PORT=8080 npm start`:

| Variable        | Default    | What it does                     |
| --------------- | ---------- | -------------------------------- |
| `PORT`          | `7272`     | The local port                   |
| `SLIDES_DIR`    | `slides`   | Where the topic folders live     |
| `REMOVED_DIR`   | `removed`  | Where removed slides go          |
| `MAX_UPLOAD_MB` | `40`       | Largest image you can import     |

The server listens only on this Mac (`127.0.0.1`), so nothing on your network can
reach it.

## Files

```
server.js                 the local server (Node's own http module, no packages)
lib/library.js            topics and slides, read from the slides/ folder
lib/live.js               which slide is on air, and the live updates (Server-Sent Events)
public/present.*          the Presentation View (OBS)
public/presenter.*        the Presenter View
test/                     npm test
```
