import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

const CHROME_PATH = '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome';
const URL = 'http://localhost:5199/';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Set a React-controlled range input value.
 * React 18 with createRoot uses native event delegation at the root.
 * We need to use the native setter + trigger React's internal onChange tracking.
 */
async function setRangeValue(page, sliderIndex, value) {
  const result = await page.evaluate(({ idx, val }) => {
    const slider = document.querySelectorAll('input[type="range"]')[idx];
    if (!slider) return { error: `No slider at index ${idx}` };

    // Get React's internal instance key
    const reactPropsKey = Object.keys(slider).find(k => k.startsWith('__reactProps$'));
    if (!reactPropsKey) return { error: 'No React props key found' };

    // Call React's onChange directly
    const reactProps = slider[reactPropsKey];
    if (reactProps && reactProps.onChange) {
      // Set the native value first
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      ).set;
      nativeSetter.call(slider, String(val));

      // Create a synthetic-like event
      reactProps.onChange({ target: slider, currentTarget: slider });
      return { success: true, value: slider.value };
    }
    return { error: 'No onChange handler found' };
  }, { idx: sliderIndex, val: value });
  return result;
}

async function main() {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--window-size=1920,1080'],
    defaultViewport: { width: 1920, height: 1080 },
  });

  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  console.log('Page loaded');

  // 1) Clear seed input and type new seed
  const seedInput = await page.$('input[type="text"]');
  await seedInput.click({ clickCount: 3 });
  await seedInput.press('Backspace');
  await seedInput.type('fjjidi77888', { delay: 30 });
  console.log('Seed set');

  // 2) Set water ratio to 65% (slider index 0)
  let r = await setRangeValue(page, 0, 65);
  console.log('Water ratio:', r);
  await sleep(200);

  // 3) Click Generate History checkbox
  await page.evaluate(() => {
    const labels = [...document.querySelectorAll('label')];
    const histLabel = labels.find(l => l.textContent.includes('Generate History'));
    const cb = histLabel.querySelector('input[type="checkbox"]');
    cb.click();
  });
  await sleep(500);
  console.log('Generate History enabled');

  // 4) Set sim years to 500 (slider index 1 after history enabled)
  r = await setRangeValue(page, 1, 500);
  console.log('Sim years:', r);
  await sleep(200);

  // Verify
  const settings = await page.evaluate(() => {
    const allText = document.body.innerText;
    return {
      seed: document.querySelector('input[type="text"]')?.value,
      waterMatch: allText.match(/Water \((\d+)%\)/)?.[1],
      simMatch: allText.match(/Sim Years \((\d+)\)/)?.[1],
      histMatch: allText.includes('GENERATE HISTORY'),
    };
  });
  console.log('Verified settings:', settings);

  // 5) Generate
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    buttons.find(b => b.textContent.includes('Generate Map')).click();
  });
  console.log('Generating...');

  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some(b => b.textContent === 'Generate Map'),
    { timeout: 600000, polling: 2000 }
  );
  console.log('Generation complete!');
  await sleep(3000);

  // List all sliders
  const sliders = await page.evaluate(() => {
    return [...document.querySelectorAll('input[type="range"]')].map((s, i) => ({
      idx: i, min: s.min, max: s.max, step: s.step, value: s.value
    }));
  });
  console.log('Sliders after gen:', sliders);

  // Timeline slider: index 2 (min=0, max=500, the year slider)
  const timelineIdx = sliders.findIndex(s => Number(s.min) === 0 && Number(s.max) >= 200 && Number(s.max) <= 5000);
  if (timelineIdx === -1) {
    console.error('Timeline slider not found!');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'debug.png') });
    await browser.close();
    return;
  }

  const maxYear = Number(sliders[timelineIdx].max);
  console.log(`Timeline slider idx=${timelineIdx}, maxYear=${maxYear}`);

  const years = [
    0,
    Math.round(maxYear / 6),
    Math.round(maxYear * 2 / 6),
    Math.round(maxYear * 3 / 6),
    Math.round(maxYear * 4 / 6),
    Math.round(maxYear * 5 / 6),
    maxYear,
  ];
  console.log('Years:', years);

  for (const year of years) {
    const setResult = await setRangeValue(page, timelineIdx, year);

    await sleep(2000); // Let canvas re-render

    // Verify
    const check = await page.evaluate(() => {
      const text = document.body.innerText;
      const m = text.match(/Year (\d+)/);
      return m?.[1];
    });
    console.log(`Set year ${year}: result=${JSON.stringify(setResult)}, display=${check}`);

    const filename = `screenshot_year_${String(year).padStart(4, '0')}.png`;
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, filename),
      fullPage: false,
    });
    console.log(`Saved: ${filename}`);
  }

  console.log('Done! Screenshots in:', SCREENSHOTS_DIR);
  await browser.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
