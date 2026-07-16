# Erve mobile branding — canonical source assets

Source-controlled inputs for all Android launcher/splash artwork. Do not
hand-edit generated resources under `native/android-template/res/mipmap-*`,
`res/drawable-nodpi`, or (especially) the gitignored `android/` platform —
edit the files here and rerun the generator.

## Files

- `erve-logo.png` — full "erve india" wordmark, duplicated byte-for-byte
  from `apps/web/public/erve-logo.png` (1117×153, RGBA, transparent
  background). Used directly on the mobile login page
  (`src/pages/LoginPage.tsx`). Duplicated rather than imported across apps
  to avoid an app-to-app runtime dependency between `apps/web` and
  `apps/mobile`; re-copy from the web asset if the web logo ever changes.
- `erve-mark-source.png` — the standalone "signal bars" mark only (no
  wordmark), extracted from `erve-logo.png` at its native resolution
  (cropped to the mark's bounding box within the full logo: left 0, top 13,
  182×140px, transparent background). This is higher-resolution than
  `apps/web/public/erve-favicon.png` (which is 107×107 with the mark
  occupying only a 93×72 region) — see the audit findings in the project's
  final report for the pixel comparison. No vector (SVG/AI/Figma) source
  exists anywhere in the repo, so this raster extraction is the best
  available source per the asset-quality rule: vector > high-res mark
  extracted from the full logo > upscaled favicon.
- `pinnacle-logo-on-dark.png` / `pinnacle-logo-on-light.png` — "Powered by
  Pinnacle Systems" provider-branding lockups, duplicated byte-for-byte from
  `apps/web/public/pinnacle-logo-on-dark.png` /
  `apps/web/public/pinnacle-logo-on-light.png` (13971×3766, RGBA, wide
  wordmark lockup, transparent background). `-on-dark` has light/white
  lettering and is used when `useTheme().resolvedTheme === "dark"`;
  `-on-light` has dark/black lettering and is used when `resolvedTheme ===
  "light"`. Supplied directly by the brand owner (not generated); do not
  crop, recolor, or regenerate. Used via the shared
  `PoweredByPinnacle`/`PoweredByPinnacleBranding` components' "row" variant
  (visible "Powered by" label + full lockup), not the Android
  launcher/splash pipeline below.
- `pinnacle-mark-on-dark.png` / `pinnacle-mark-on-light.png` — the
  standalone triangular Pinnacle mark only (no "PINNACLE Systems"
  wordmark), duplicated byte-for-byte from
  `apps/web/public/pinnacle-mark-on-dark.png` /
  `apps/web/public/pinnacle-mark-on-light.png` (512×446, RGBA, transparent
  background). Brand-owner-supplied square mark exports (not cropped out of
  the wide `pinnacle-logo-on-*.png` lockups — the full wordmark stops being
  legible once scaled down much below its native footprint, so a separate
  purpose-built mark asset is used instead of a shrunk copy of the lockup).
  Sourced from two owner-supplied originals distinguished by which color
  fills the triangle's solid bars (the diagonal orange accent strokes are
  the same in both): the file with **white** bars is the dark-background
  version (`-on-dark`, used when `useTheme().resolvedTheme === "dark"`);
  the file with **black** bars is the light-background version (`-on-light`,
  used when `resolvedTheme === "light"`) — verify by sampling a bar pixel's
  RGB if re-deriving these, since the owner's own filenames for the two
  originals don't reliably indicate which is which. Each was tight-cropped
  to its non-transparent bounding box (dropping incidental export padding)
  and downscaled from its ~3500px-square original to 512px wide (both
  variants resized to the identical 512×446 box so swapping theme doesn't
  shift the image's footprint by a stray pixel) — 512px is comfortably
  above any rendered size this mark is used at, even at high-DPI. Used via
  the shared `PoweredByPinnacle`/`PoweredByPinnacleBranding` components'
  "compact" variant (collapsed sidebar and any other icon-only slot). Do
  not recolor; re-derive from updated owner originals with the same
  crop/resize recipe if the source mark ever changes.

## Generation

`apps/mobile/scripts/generate-branding.mjs` reads `erve-mark-source.png` and
writes every Android launcher-icon and splash-icon resource into
`native/android-template/res/`:

| Output | Source | Notes |
| --- | --- | --- |
| `mipmap-*/ic_launcher_foreground.png` | `erve-mark-source.png`, resized to 60% of the 108dp adaptive-icon canvas, centered on transparent | Adaptive icon foreground layer |
| `mipmap-*/ic_launcher_monochrome.png` | Same mark, recolored to solid white (alpha preserved) | Android 13+ themed-icon layer |
| `mipmap-*/ic_launcher.png`, `ic_launcher_round.png` | Mark composited over `@color/erve_launcher_background` (`#FBFCFE`) at 48dp legacy canvas | Pre-API-26 fallback / round-icon fallback |
| `drawable-nodpi/erve_splash_icon.png` | Mark resized to 42% of a 480px transparent canvas | Purpose-built splash asset — deliberately NOT the launcher foreground (reusing the foreground here was the cause of the earlier white/plate-look splash bug) |

Run via `pnpm --filter @erve/mobile branding:generate`. The script is
deterministic: same input + same constants always produce byte-identical
PNGs. `apps/mobile/scripts/configure-android-theme.mjs` then copies these
(already-generated, source-controlled) template files into the gitignored
`android/` platform, exactly like it already does for the theme/color XML
and native-bridge Java files.

## Known limitation

Both source rasters (`erve-logo.png`, `erve-favicon.png`) are modest
resolution and no vector master exists. The generator upscales
`erve-mark-source.png` with Lanczos3 resampling, which is clean for this
mark's simple flat-color rounded-bar geometry but is still an upscale, not a
true high-resolution master. If a vector (SVG) source ever becomes
available, replace `erve-mark-source.png` with an export from it and rerun
the generator — no other changes are required.
