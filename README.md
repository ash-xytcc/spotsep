# SpotSep Cloudflare Pages build

This is a static browser-only version of SpotSep.

## What changed
- No Python backend
- No Inkscape dependency
- SVG rasterization happens in the browser
- Analysis, preview, and ZIP export happen client-side
- Ready for static hosting on Cloudflare Pages

## Local test
Open `index.html` with a simple static server if you want, or deploy the folder directly.

## Cloudflare Pages deploy
You can deploy a directory of static files with Wrangler using:

`npx wrangler pages deploy . --project-name YOUR_PROJECT_NAME`

You can also use Cloudflare Pages Direct Upload from the dashboard for a prebuilt static folder.
