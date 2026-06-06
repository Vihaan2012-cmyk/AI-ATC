# In-sim widget (MSFS 2024 toolbar panel)

The widget is a chat UI for ATC. It runs in two places:

1. **A browser** (for dev) — open `atc-widget.html` while `npm run server` is running.
2. **An MSFS toolbar panel** — a thin panel whose `<iframe>` loads the widget that the brain
   serves over HTTP, so the WebSocket from that page is same-origin.

```
widget/
  atc-widget.html          the chat UI (served by `npm run server` at http://localhost:8742/)
  msfs-package/            the MSFS 2024 toolbar-panel package (source)
```

## How it connects (the Path A design)

`npm run server` serves the widget at `http://localhost:8742/` **and** the WebSocket at
`ws://localhost:8742` on the same port. The toolbar panel's iframe points at
`http://localhost:8742/`; that page then opens the same-origin WebSocket. (Loading
`http://localhost` content in an in-game-panel iframe is the proven community pattern.)

So: **start the brain server first**, then open the panel in the sim.

## Build the toolbar package

The package source is in `msfs-package/` (modeled on the proven community in-game-panel
template; the panel is registered via `PackageSources/panels/InGamePanel_AIATC.xml`).

**Recommended — in-sim Project Editor (reliable):**
1. MSFS 2024 → Developer Mode ON → dev toolbar → **Tools → Project Editor**.
2. **Open Project** → select `widget/msfs-package/ai-atc-panel.xml`.
3. **Build** (Build All). The built package appears under `widget/msfs-package/Packages/msfs-ai-atc-panel/`
   and the Project Editor can load it directly for testing.
4. If testing outside the editor, copy `Packages/msfs-ai-atc-panel` into your MSFS **Community** folder.

**CLI alternative:** `msfs-package/build.bat` calls `fspackagetool.exe`. The standalone CLI is
finicky (it may exit without building); prefer the Project Editor.

## Use it

1. `npm run server` (brain + widget HTTP/WS on :8742).
2. In a flight, click the **AI ATC** icon in the toolbar → the panel opens and loads the widget.
3. Type your calls; ATC replies using your sim's real frequencies.

## Troubleshooting

- **No toolbar button:** confirm the package built and is in Community; the icon name in
  `InGamePanel_AIATC.xml` (`ICON_TOOLBAR_AI_ATC`) must match an SVG. We ship it under both
  `html_ui/icons/toolbar/` (2024) and `html_ui/Textures/Menu/toolbar/` (legacy) to be safe.
- **Panel opens but is blank / "can't connect":** make sure `npm run server` is running, and the
  port matches `AIATC_URL` in `AIATC.js` (default `http://localhost:8742/`).
- **If the iframe can't load `http://localhost` (Coherent blocks it = "Path B"):** fall back to
  bridging text through a WASM gauge via a SimConnect Client Data Area. The brain side is
  unchanged — only the panel's transport differs.
- **Custom port:** if you set `WS_PORT`, update `AIATC_URL` in `AIATC.js` to match.
