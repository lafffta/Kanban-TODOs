# Production dependency advisories

`npm audit --omit=dev` is the gate that matters: it reports what ships. This file
records how the advisories it found were dispositioned, and why the fix is a pair
of `overrides` rather than what the tool suggested.

Status: **`npm audit --omit=dev` reports 0 vulnerabilities.**

## Why not `npm audit fix --force`

The tool's own advice was:

> fix available via `npm audit fix --force`
> Will install next@9.3.3, which is a breaking change

`next@9.3.3` predates the App Router. Taking it would have deleted the framework
this app is built on to silence a report — the audit fixer optimises for "no
advisory", not for a working application.

## The advisories, and where they actually reach

### postcss — 4 advisories, high

- GHSA-qx2v-qp2m-jg93 — XSS via unescaped `</style>` in stringify output
- GHSA-6g55-p6wh-862q / GHSA-fxqj-rqcc-2cmp — arbitrary file read via
  attacker-controlled `sourceMappingURL`
- GHSA-r28c-9q8g-f849 — path traversal in previous-source-map auto-loading

**Path:** `next → postcss` (`node_modules/next/node_modules/postcss`).

**Reachable surface:** build time only. Next runs postcss over this repo's own
Tailwind sources; the CSS it processes is authored here, not supplied by a user.
Every one of these advisories needs attacker-controlled CSS text (or an
attacker-controlled `sourceMappingURL` comment inside it) to do anything. The app
has no route, form, or upload that feeds CSS into the pipeline.

**Why an override was still needed:** it cannot be fixed by upgrading Next. Next
pins postcss **exactly** — `"postcss": "8.4.31"` — and pins that same version in
every release, `15.5.21` and `15.5.22` and `16.2.12` alike. There is no Next
version to move to. The override takes postcss to `^8.5.25`, which is the same
major and API-compatible with what Next calls.

### sharp — 1 advisory, high

- GHSA-f88m-g3jw-g9cj — inherited libvips CVEs (CVE-2026-33327, -33328,
  -35590, -35591)

**Path:** `next → sharp` (an **optional** dependency; it is installed because it
installs cleanly, not because anything asked for it).

**Reachable surface:** none. sharp is Next's image-optimisation backend, and this
app never invokes it — there is no `next/image` import anywhere in `app/`, no
`images` config in `next.config.ts`, and no source file in the repo references
sharp at all. It sits on disk unloaded.

**Why an override anyway:** unreachable is not the same as absent, and a patched
copy costs nothing here. `^0.35.3` is outside Next's declared `^0.34.3` optional
range, which would be a real risk if the image optimiser were in use — it is the
one override to revisit if `next/image` is ever adopted, because sharp 0.35
carries breaking changes Next's `^0.34` range was written against.

## The overrides

```json
"overrides": {
  "postcss": "^8.5.25",
  "sharp": "^0.35.3"
}
```

Nothing else moved: no major downgrade, no forced lockfile rewrite. The lockfile
diff is these two packages and their own dependency closures.

## Development-only advisories

`npm audit` without `--omit=dev` still reports findings via `drizzle-kit` →
`@esbuild-kit/esm-loader`. Those are **deliberately out of scope**: drizzle-kit
runs on a developer's machine and in migrations, never in the deployed bundle, and
the fix available is a drizzle-kit major that would need its own migration
testing. Tracked separately rather than bundled into a production-advisory change.

## Re-checking

```
npm audit --omit=dev     # must stay at 0
npm run lint && npm run typecheck && npm test && npm run build
```

The build is the meaningful check for the postcss override, since postcss is what
compiles the stylesheet — a broken override shows up as missing or malformed CSS,
not as a failing unit test.
