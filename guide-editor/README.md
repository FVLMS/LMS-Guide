# BlockNote Editor Starter (Client-Side, Import/Export, Autosave)

A minimal, client‑side BlockNote editor you can deploy to **GitHub Pages**. It supports:

- **WYSIWYG** editing (BlockNote)
- **Import JSON** (load a saved BlockNote document)
- **Export JSON / HTML / MDX**
- **LocalStorage autosave** + restore prompt
- A simple filename field that slugifies for export

> No backend. No database. Nothing leaves the browser until you export.

## Quick start

```bash
# 1) Install deps
npm install

# 2) Run locally
npm run dev

# 3) Build static site
npm run build
```

## Deploy to GitHub Pages

1. Commit this repo to GitHub.
2. Enable **Pages** → **Build and deployment** → **Source: GitHub Actions**.
3. Push to `main` (or run the workflow manually). The included workflow deploys `dist/` to Pages.

If your repo is a **project site** (e.g. `/your-repo`), we already set `vite.config.ts` with `base: './'` so paths work under a subfolder.

## Usage

- Click **New** to start fresh.
- **Import JSON** to load a previously exported draft (`*.json`).
- **Export JSON** for drafts.
- **Export HTML** for static publishing.
- **Export MDX** if your Astro/Starlight site consumes MDX (raw HTML is embedded in the MDX file).

> After exporting, commit the file(s) to your docs repo (e.g., `src/content/docs/...`) and ship.

## Notes

- Autosave stores your current doc under `localStorage`. It’s per‑browser and can be cleared by the user.
- The **beforeunload** prompt warns if you have unsaved changes (haven’t exported). Export clears the “dirty” flag.
- If you need **columns** or custom blocks, you can extend BlockNote or serialize to MDX components later.

## License

MIT
