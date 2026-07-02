#!/usr/bin/env node
/**
 * Render unticket product mockups (HTML in _mockups/) to PNGs in img/, and
 * (with `site`) snapshot the full landing page to _review/ for design review.
 *
 * Mirrors noxkey/scripts/generate-screenshots.mjs: author UI scenes as HTML,
 * screenshot at 2x. Uses puppeteer-core against the system Chrome (no download).
 *
 *   cd website && node scripts/render-mockups.mjs            # all mockups
 *   cd website && node scripts/render-mockups.mjs sprint      # one mockup
 *   cd website && node scripts/render-mockups.mjs site        # full-page site shots
 *
 * `site` requires the dev server running: python3 -m http.server 8090
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MOCKUPS = join(ROOT, '_mockups');
const IMG = join(ROOT, 'img');
mkdirSync(IMG, { recursive: true });

const CHROME =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const W = 1440, H = 900;

const SHOTS = [
  ['sprint', 'sprint.png'],
  ['issues', 'issues.png'],
  ['prs', 'prs.png'],
  ['engineers', 'engineers.png'],
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--force-color-profile=srgb', '--disable-gpu'],
});

const arg = process.argv[2];

if (arg === 'site') {
  const REVIEW = join(ROOT, '_review');
  mkdirSync(REVIEW, { recursive: true });
  const views = [
    { w: 1280, name: 'desktop' },
    { w: 390, name: 'mobile' },
  ];
  for (const { w, name } of views) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
    await page.goto('http://localhost:8090/', { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    // force-reveal every section so the full-page shot isn't half-hidden
    await page.evaluate(() =>
      document.querySelectorAll('.reveal').forEach((el) => el.classList.add('visible'))
    );
    const buf = await page.screenshot({ type: 'png', fullPage: true });
    writeFileSync(join(REVIEW, `site-${name}.png`), buf);
    console.log(`  site-${name}.png  ${(buf.length / 1024).toFixed(0)} KB`);
    await page.close();
  }
} else {
  const queue = arg ? SHOTS.filter(([n]) => n === arg) : SHOTS;
  for (const [name, out] of queue) {
    const src = join(MOCKUPS, `${name}.html`);
    if (!existsSync(src)) {
      console.log(`  skip ${name} (no ${name}.html yet)`);
      continue;
    }
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
    await page.goto('file://' + src, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } });
    writeFileSync(join(IMG, out), buf);
    console.log(`  ${out}  ${(buf.length / 1024).toFixed(0)} KB`);
    await page.close();
  }

  // OG social card (1200x630) -> website/og-image.png
  const ogSrc = join(MOCKUPS, 'og-image.html');
  if (existsSync(ogSrc)) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });
    await page.goto('file://' + ogSrc, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
    writeFileSync(join(ROOT, 'og-image.png'), buf);
    console.log(`  og-image.png  ${(buf.length / 1024).toFixed(0)} KB`);
    await page.close();
  }
}

await browser.close();
console.log('Done.');
