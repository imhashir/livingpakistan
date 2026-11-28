// Renders web/public/icon-*.png (home-screen icons, see manifest.webmanifest): the favicon's flag on the HUD's dark ground.
//   node scripts/mux/icons.mjs web/index.html web/public
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [html, outDir] = process.argv.slice(2);
const src = readFileSync(html, 'utf8');
const uri = src.match(/<link rel="icon" href="(data:image\/svg\+xml,[^"]+)"/)[1];
const svg = decodeURIComponent(uri.slice('data:image/svg+xml,'.length));
const b = await chromium.launch();
for (const size of [180, 192, 512]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  const w = Math.round(size * 0.74);
  await p.setContent(`<body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:radial-gradient(ellipse at center,#102630 0%,#07090d 75%)">
    <div style="width:${w}px;height:${Math.round(w * 2 / 3)}px;box-shadow:0 ${size / 40}px ${size / 12}px rgba(0,0,0,.6)">${svg.replace('<svg ', `<svg width="${w}" height="${Math.round(w * 2 / 3)}" `)}</div></body>`);
  await p.screenshot({ path: `${outDir}/icon-${size}.png` });
  await p.close();
}
await b.close();
