// Rasterize assets/logo.svg into PNG icons (stores require PNG, the repo only
// keeps the SVG). Uses the repo's Playwright Chromium — no extra image deps.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

// Writes icon<size>.png for each size into iconsDir (created if missing).
export async function rasterizeIcons(iconsDir, sizes) {
  const svg = await readFile(join(ROOT, 'assets', 'logo.svg'), 'utf8');
  await mkdir(iconsDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
    );
    await writeFile(
      join(iconsDir, `icon${size}.png`),
      await page.screenshot({ omitBackground: true })
    );
  }
  await browser.close();
}
