# LaterLab

A personal library and watch-planning tool for a YouTube Watch Later backlog. It keeps notes, tags and progress alongside the videos, builds daily watch plans, and can carry the library between devices through encrypted synchronization.

[Türkçe](README.tr.md)

The repository contains the web application and its Firefox companion. The add-on collects changes from the signed-in YouTube session and records actual playback; the web app handles the library, planning and review.

## Main workflows

- Import a complete snapshot, then merge incremental updates without replacing personal notes or progress.
- Search titles, channels, notes and tags. Optional YouTube metadata adds descriptions and creator tags, with matching text shown in the result.
- Plan ordinary videos or slices of a long video within a daily time budget.
- Keep manual progress and watch history when moving between devices.
- In Firefox, resume library videos at the saved position and count observed playback rather than seeks, buffering or paused time.
- Export a backup and synchronize an encrypted library using a pairing code.

Search is text-based. It does not search spoken transcripts or infer a topic that is absent from the available text. Playback tracking covers the supported Firefox profile and pages; phone/TV history is not imported automatically.

## Source layout

```text
cloudflare/          Worker, Durable Object and web assets
firefox-extension/  Manifest, bundled scripts and editable modules
tests/              Import, search, planning, sync and extension regressions
scripts/            Extension bundle build
```

The web app uses JavaScript modules, browser storage and Web Crypto. Cloudflare Workers serves the application; a SQLite Durable Object stores encrypted sync documents. Revision checks detect conflicting updates. The Firefox add-on uses storage, alarms and scripting permissions, restricted to YouTube and the configured application origin.

## Local checks

Use Node.js 24 or a compatible Node version with the Web Crypto APIs used by the tests.

```bash
npm test
```

The portable suite runs 22 test programs. It covers a 3,100-row synthetic import, duplicate and older imports, preserved edits, content-search matches, expired metadata, long-video plans, observed playback, wrong-key rejection and conflicting sync writes. Personal-library audit files are excluded from this repository.

To rebuild the add-on bundles:

```bash
npm ci
npm run build:extension
```

Load `firefox-extension/manifest.json` through Firefox's temporary add-on loader for development. Distribution builds need Mozilla signing; an unsigned development folder is not an installable release.

## Run the web application

```bash
npx wrangler dev --config cloudflare/wrangler.jsonc
```

Before deploying your own instance, set the Worker name and the extension's permitted application origin. Configure `SYNC_AUTH_HASH` as a Worker secret for the owner credential. `YOUTUBE_API_KEY` is optional and stays on the Worker; the base title/channel/note search works without it. Use the app's pairing flow to connect a browser to the configured sync store.

```bash
npx wrangler secret put SYNC_AUTH_HASH --config cloudflare/wrangler.jsonc
npx wrangler secret put YOUTUBE_API_KEY --config cloudflare/wrangler.jsonc
```

Keep a separate exported backup. A pairing code is needed to decrypt a synced library, and browser storage can be cleared. YouTube page structures can change, so collection behavior should be checked after a site or add-on update.
