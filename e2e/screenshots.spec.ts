/**
 * Screenshot capture script for OS Assistant.
 *
 * Captures key UI states for the README and project documentation.
 *
 * Usage:
 *   npx playwright test e2e/screenshots.spec.ts
 *
 * Output: screenshots/*.png
 */

import { test, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// Load .env file for TEST_DEEPSEEK_API_KEY (same logic as helpers.ts)
(function loadEnv(): void {
  if (process.env.TEST_DEEPSEEK_API_KEY) return;
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && value && !process.env[key]) {
      process.env[key] = value;
    }
  }
})();

const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Shared launch helper.
 */
async function launchApp() {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'dist', 'main', 'main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('load', { timeout: 15000 });
  await page.waitForSelector('.app', { timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(500);
  return { app, page };
}

test.describe('OS Assistant — Screenshots', () => {
  test('main-ui-and-settings', async () => {
    ensureDir(SCREENSHOT_DIR);
    const { app, page } = await launchApp();

    // ── Screenshot 1: Main UI (default) ──
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'main-ui.png'),
      fullPage: false,
    });
    console.log('✓ Captured: main-ui.png');

    // ── Screenshot 2: Main UI (wider) ──
    await page.setViewportSize({ width: 1400, height: 800 });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'main-ui-wide.png'),
      fullPage: false,
    });
    console.log('✓ Captured: main-ui-wide.png');

    await app.close();
  });

  test('settings-panel', async () => {
    ensureDir(SCREENSHOT_DIR);
    const { app, page } = await launchApp();

    // ── Screenshot 3: Settings panel ──
    const settingsBtn = page.locator('.settings-gear-btn');
    await settingsBtn.waitFor({ state: 'visible', timeout: 5000 });
    await settingsBtn.click();
    await page.waitForTimeout(800);
    await page.locator('.settings-overlay').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(600);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'settings-panel.png'),
      fullPage: false,
    });
    console.log('✓ Captured: settings-panel.png');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await app.close();
  });

  test('about-dialog-and-chat', async () => {
    ensureDir(SCREENSHOT_DIR);
    const { app, page } = await launchApp();

    // ── Screenshot 4: About dialog ──
    const aboutBtn = page.locator('.status-bar-right button', { hasText: 'About' });
    await aboutBtn.waitFor({ state: 'visible', timeout: 5000 });
    await aboutBtn.click();
    await page.waitForTimeout(800);
    await page.locator('.about-dialog').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'about-dialog.png'),
      fullPage: false,
    });
    console.log('✓ Captured: about-dialog.png');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // ── Screenshot 5: Chat interaction (with API key) ──
    const apiKey = process.env.TEST_DEEPSEEK_API_KEY;
    if (apiKey) {
      console.log('API key found — capturing chat interaction...');

      // Open settings
      const settingsBtn = page.locator('.settings-gear-btn');
      await settingsBtn.click();
      await page.waitForTimeout(800);
      await page.locator('.settings-overlay').waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(500);

      // Fill API key in the password input
      const keyInput = page.locator('.api-key-input input[type="password"]');
      await keyInput.waitFor({ state: 'visible', timeout: 5000 });
      await keyInput.fill(apiKey);
      await page.waitForTimeout(300);

      // Click OK button
      const okBtn = page.locator('.settings-footer .btn-primary', { hasText: 'OK' });
      await okBtn.waitFor({ state: 'visible', timeout: 5000 });
      await okBtn.click();
      await page.waitForTimeout(1500);

      // Type a message
      const chatInput = page.locator('.chat-input');
      await chatInput.waitFor({ state: 'visible', timeout: 5000 });
      await chatInput.fill('Hello! What can you help me with?');
      await page.keyboard.press('Enter');

      // Wait for response to start streaming
      await page.waitForTimeout(4000);

      // Screenshot during streaming
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'chat-streaming.png'),
        fullPage: false,
      });
      console.log('✓ Captured: chat-streaming.png');

      // Wait for more response content
      await page.waitForTimeout(10000);

      // Screenshot with full response
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'chat-response.png'),
        fullPage: false,
      });
      console.log('✓ Captured: chat-response.png');
    } else {
      console.log('No TEST_DEEPSEEK_API_KEY found — skipping chat interaction screenshots');
    }

    await app.close();
  });

  test('weather-screenshot', async () => {
    ensureDir(SCREENSHOT_DIR);
    const { app, page } = await launchApp();

    const apiKey = process.env.TEST_DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.log('No TEST_DEEPSEEK_API_KEY found — skipping weather screenshot');
      await app.close();
      return;
    }

    console.log('API key found — capturing weather question...');

    // Open settings
    const settingsBtn = page.locator('.settings-gear-btn');
    await settingsBtn.click();
    await page.waitForTimeout(800);
    await page.locator('.settings-overlay').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    // Fill API key
    const keyInput = page.locator('.api-key-input input[type="password"]');
    await keyInput.waitFor({ state: 'visible', timeout: 5000 });
    await keyInput.fill(apiKey);
    await page.waitForTimeout(300);

    // Click OK
    const okBtn = page.locator('.settings-footer .btn-primary', { hasText: 'OK' });
    await okBtn.waitFor({ state: 'visible', timeout: 5000 });
    await okBtn.click();
    await page.waitForTimeout(1500);

    // Ask about the weather
    const chatInput = page.locator('.chat-input');
    await chatInput.waitFor({ state: 'visible', timeout: 5000 });
    await chatInput.fill("What's the weather like today?");
    await page.keyboard.press('Enter');

    // Wait for the AI to detect location and fetch weather
    await page.waitForTimeout(6000);

    // Screenshot while AI is working on it (showing tool calls / thinking)
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'weather-streaming.png'),
      fullPage: false,
    });
    console.log('✓ Captured: weather-streaming.png');

    // Wait for full weather response
    await page.waitForTimeout(15000);

    // Screenshot with final weather answer
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'weather-response.png'),
      fullPage: false,
    });
    console.log('✓ Captured: weather-response.png');

    await app.close();
  });
});
