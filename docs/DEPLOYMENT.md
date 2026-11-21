# Chelo deployment notes

## GitHub Pages

Use the included `.github/workflows/pages.yml` and enable GitHub Pages with GitHub Actions as source. The workflow runs `build-static.sh` and publishes `_site/`. The expected project-site path is `/Chelo/`; all HTML, CSS, model, service-worker and Worker URLs are relative. Keep the repository root as the Pages artifact. `.nojekyll` prevents Jekyll processing.

GitHub Pages does not support custom response headers. The app detects the lack of cross-origin isolation and falls back to single-worker search rather than trying to use an unavailable SharedArrayBuffer.

## Cloudflare Pages

Connect the repository with build command `./build-static.sh` and output directory `_site`. Cloudflare Pages reads `_headers` and applies same-origin COOP/COEP/CORP headers. These enable `crossOriginIsolated` and SharedArrayBuffer where the browser supports them.

## Cloudflare Arena Worker

The separate Worker is under `workers/arena/`. Before deployment:

1. Create the D1 database for Chelo Arena.
2. Replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` in `workers/arena/wrangler.toml`.
3. Set `CORS_ORIGIN` to the deployed Chelo Pages origin.
4. Run `wrangler deploy` from `workers/arena/`.

The static chess app does not depend on Arena availability for local play or pet learning.
