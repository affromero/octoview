// Chrome-build check: loads build/chrome into a real Chromium and exercises the
// paths the render e2e cannot (it has no extension origin): the content script
// injecting on a blob page, the sandboxed viewer running a report's own scripts
// LIVE, and the splat viewer page (or its main-thread fallback). github.com is
// route-intercepted, so the test is hermetic — no network, no login.
//
//   npm run test:chrome   (builds first)
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const EXT = join(ROOT, 'build', 'chrome');

// A minimal stand-in for a github blob page: the raw anchor (URL resolution +
// button placement) and a .Box-body (the content region the pane replaces).
const blobPage = (file) => `<!doctype html><html><body>
  <a href="https://github.com/o/r/raw/main/samples/${file}">Raw</a>
  <div class="Box-body"><pre>raw code view of ${file}</pre></div>
</body></html>`;

const CASES = [
  {
    file: 'report.html',
    // The sample's badge flips to LIVE only when its own scripts execute —
    // proof the manifest-sandbox viewer works where Safari needs 'unsafe-inline'.
    check: async (page) => {
      for (const f of page.frames()) {
        const live = await f
          .locator('text=LIVE')
          .first()
          .isVisible()
          .catch(() => false);
        if (live) return true;
      }
      return false;
    },
  },
  {
    file: 'points.ply',
    check: (page) =>
      page
        .locator('#octoview-pane canvas')
        .first()
        .isVisible()
        .catch(() => false),
  },
  {
    file: 'capybara.splat',
    // Spark viewer canvas (in the extension iframe) or the main-thread
    // fallback canvas (in the pane) — either proves the splat path survives.
    // The fallback also exposes the coordinate selector whenever it exposes Axes.
    check: async (page) => {
      const canvas = page.locator('#octoview-pane canvas').first();
      if (await canvas.isVisible().catch(() => false)) {
        const coords = page.locator('#octoview-pane .ov3d-panel select').first();
        if (!(await coords.isVisible().catch(() => false))) return false;
        await coords.selectOption({ label: 'Z-up (Blender, ROS, CAD)' });
        return (await coords.inputValue()) === 'Z-up (Blender, ROS, CAD)';
      }
      for (const frame of page.frames()) {
        if (!frame.url().includes('splat-viewer.html')) continue;
        if (
          await frame
            .locator('canvas')
            .first()
            .isVisible()
            .catch(() => false)
        )
          return true;
      }
      return false;
    },
  },
];

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

await ctx.route('https://github.com/**', async (route) => {
  const { pathname } = new URL(route.request().url());
  if (pathname.includes('/raw/')) {
    const body = await readFile(
      join(ROOT, pathname.split('/samples/')[1] ? 'samples' : '.', pathname.split('/').pop())
    );
    return route.fulfill({ body, contentType: 'application/octet-stream' });
  }
  return route.fulfill({
    body: blobPage(pathname.split('/').pop()),
    contentType: 'text/html',
    headers: {
      // github-like CSP: without it the static srcdoc fallback could run the
      // report's scripts too, and the LIVE assertion would prove nothing.
      'content-security-policy':
        "default-src 'none'; script-src github.githubassets.com; style-src 'unsafe-inline'; " +
        "img-src * data: blob:; frame-src 'self' chrome-extension:; connect-src *",
    },
  });
});

let failed = 0;
for (const { file, check } of CASES) {
  const page = await ctx.newPage();
  await page.goto(`https://github.com/o/r/blob/main/samples/${file}`);
  const btn = page.locator('#octoview-btn');
  const injected = await btn.waitFor({ timeout: 10000 }).then(
    () => true,
    () => false
  );
  if (!injected) {
    console.error(
      `✗ ${file}: Preview button never injected — extension not loaded (manifest rejected?)`
    );
    failed++;
    await page.close();
    continue;
  }
  await btn.click();
  let ok = false;
  const deadline = Date.now() + 25000;
  while (!ok && Date.now() < deadline) {
    ok = await check(page);
    if (!ok) await page.waitForTimeout(500);
  }
  console.log(`${ok ? '✓' : '✗'} [chrome-ext] ${file}`);
  if (!ok) failed++;
  await page.close();
}
await ctx.close();
if (failed) {
  console.error(`${failed} chrome extension case(s) failed`);
  process.exit(1);
}
console.log('chrome extension cases passed ✓');
