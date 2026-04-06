import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { createServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Start Vite dev server
  console.log('Starting Vite dev server...');
  const server = await createServer({
    root: __dirname,
    server: { port: 5199, host: '127.0.0.1' },
  });
  await server.listen();
  console.log('Vite dev server ready at http://127.0.0.1:5199');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  try {
    // Navigate to app
    await page.goto('http://127.0.0.1:5199', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Configure generation parameters
    console.log('Setting up generation parameters...');

    // Set seed to "map_xxxxl"
    const seedInput = page.locator('input[type="text"][placeholder="e.g. fantasy"]');
    await seedInput.fill('map_xxxxl');
    await page.waitForTimeout(200);

    // Set cells to 100k
    await page.locator('button', { hasText: '100k' }).click();
    await page.waitForTimeout(200);

    // Set water ratio to 65%
    await page.evaluate(() => {
      const sliders = document.querySelectorAll('input[type="range"]');
      for (const s of sliders) {
        const max = parseInt(s.getAttribute('max') || '0');
        if (max === 100) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          nativeInputValueSetter?.call(s, 65);
          s.dispatchEvent(new Event('input', { bubbles: true }));
          s.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    });
    await page.waitForTimeout(200);

    // Enable history generation
    const historyLabel = page.locator('label', { hasText: 'Generate History' });
    await historyLabel.locator('input[type="checkbox"]').check();
    await page.waitForTimeout(500);

    console.log('Generating map with seed="map_xxxxl", 100k cells, 65% water...');

    // Click "Generate Map" button
    await page.locator('button', { hasText: 'Generate Map' }).click();

    // Wait for generation to complete (the button text changes from "Generating..." back to "Generate Map")
    console.log('Waiting for map generation...');
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('button');
        // Look for the generate button specifically
        const buttons = document.querySelectorAll('button');
        for (const b of buttons) {
          if (b.textContent === 'Generate Map') return true;
        }
        return false;
      },
      { timeout: 600000 }
    );
    await page.waitForTimeout(2000);
    console.log('Map generated!');

    // Get the canvas and map dimensions
    const mapInfo = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return {
        width: canvas?.width || 1920,
        height: canvas?.height || 1080,
      };
    });
    console.log(`Map dimensions: ${mapInfo.width}x${mapInfo.height}`);

    // Hide the event log to get cleaner screenshots
    const hideLogBtn = page.locator('button', { hasText: 'Hide Log' });
    if (await hideLogBtn.isVisible()) {
      await hideLogBtn.click();
      await page.waitForTimeout(300);
    }

    // Collapse the controls panel for cleaner screenshots
    const collapseBtn = page.locator('button[title="Collapse"]').first();
    if (await collapseBtn.isVisible()) {
      await collapseBtn.click();
      await page.waitForTimeout(300);
    }

    // Get the max year from the timeline slider
    const maxYear = await page.evaluate(() => {
      const slider = document.querySelector('input[type="range"][max]');
      if (!slider) return 4999;
      // Find the timeline slider (has max > 100)
      const sliders = document.querySelectorAll('input[type="range"]');
      for (const s of sliders) {
        const max = parseInt(s.getAttribute('max') || '0');
        if (max > 100) return max;
      }
      return 4999;
    });
    console.log(`Max year: ${maxYear}`);

    // Define 15 screenshot configurations: different timeline points and map areas
    // We'll use different timeline years and scroll to different map positions
    const screenshots = [
      { year: 0, name: '01_year_0000_overview', desc: 'Year 0 - Beginning of history, overview' },
      { year: Math.floor(maxYear * 0.02), name: '02_early_foundations', desc: 'Early foundations' },
      { year: Math.floor(maxYear * 0.07), name: '03_first_countries', desc: 'First countries forming' },
      { year: Math.floor(maxYear * 0.12), name: '04_early_expansion', desc: 'Early expansion', panX: -200, panY: -100 },
      { year: Math.floor(maxYear * 0.18), name: '05_growing_nations', desc: 'Growing nations', panX: 200, panY: 0 },
      { year: Math.floor(maxYear * 0.25), name: '06_quarter_progress', desc: '25% through history' },
      { year: Math.floor(maxYear * 0.33), name: '07_third_progress', desc: 'One third through history', panX: -300, panY: 100 },
      { year: Math.floor(maxYear * 0.40), name: '08_rising_empires', desc: 'Rising empires', panX: 300, panY: -50 },
      { year: Math.floor(maxYear * 0.50), name: '09_midpoint', desc: 'Midpoint of history' },
      { year: Math.floor(maxYear * 0.60), name: '10_mature_world', desc: 'Mature civilizations', panX: -400, panY: 0 },
      { year: Math.floor(maxYear * 0.70), name: '11_late_era', desc: 'Late era wars and conquests', panX: 200, panY: 100 },
      { year: Math.floor(maxYear * 0.80), name: '12_four_fifths', desc: '80% through history' },
      { year: Math.floor(maxYear * 0.88), name: '13_near_end', desc: 'Approaching end of history', panX: -200, panY: -80 },
      { year: Math.floor(maxYear * 0.95), name: '14_final_era', desc: 'Final era', panX: 400, panY: 50 },
      { year: maxYear, name: '15_year_final_end', desc: 'End of history - final state' },
    ];

    for (const config of screenshots) {
      console.log(`Taking screenshot: ${config.desc} (year ${config.year})...`);

      // Set the timeline year by modifying the slider
      await page.evaluate((year) => {
        const sliders = document.querySelectorAll('input[type="range"]');
        for (const s of sliders) {
          const max = parseInt(s.getAttribute('max') || '0');
          if (max > 100) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            nativeInputValueSetter?.call(s, year);
            s.dispatchEvent(new Event('input', { bubbles: true }));
            s.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }, config.year);

      await page.waitForTimeout(800);

      // Pan the map if specified
      if (config.panX || config.panY) {
        const canvas = page.locator('canvas').first();
        const box = await canvas.boundingBox();
        if (box) {
          const startX = box.x + box.width / 2;
          const startY = box.y + box.height / 2;
          await page.mouse.move(startX, startY);
          await page.mouse.down();
          await page.mouse.move(startX + (config.panX || 0), startY + (config.panY || 0), { steps: 10 });
          await page.mouse.up();
          await page.waitForTimeout(500);
        }
      }

      await page.screenshot({
        path: path.join(__dirname, 'improved', `${config.name}.png`),
        fullPage: false,
      });
      console.log(`  Saved: improved/${config.name}.png`);

      // Reset pan for next screenshot (unless next one also pans)
      if (config.panX || config.panY) {
        const canvas = page.locator('canvas').first();
        const box = await canvas.boundingBox();
        if (box) {
          const startX = box.x + box.width / 2;
          const startY = box.y + box.height / 2;
          await page.mouse.move(startX, startY);
          await page.mouse.down();
          await page.mouse.move(startX - (config.panX || 0), startY - (config.panY || 0), { steps: 10 });
          await page.mouse.up();
          await page.waitForTimeout(300);
        }
      }
    }

    console.log('\nAll 15 screenshots taken successfully!');
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
