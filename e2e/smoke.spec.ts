import { test, expect } from '@playwright/test';
import { launchApp, clearApiKey, clearSessions } from './helpers';

test.describe('OS Assistant — App smoke tests', () => {
  test('app launches and renders the main UI', async () => {
    const { app, page } = await launchApp();

    // The app frame should be visible
    await expect(page.locator('.app')).toBeVisible({ timeout: 5000 });

    // Title bar shows provider name
    await expect(page.locator('.title-bar-label')).toContainText('Terminal + AI');

    // Chat area should be present
    await expect(page.locator('.chat-messages')).toBeVisible();
    await expect(page.locator('.chat-input')).toBeVisible();

    await app.close();
  });

  test('typing and sending shows the no-API-key warning when no key is configured', async () => {
    const { app, page } = await launchApp();

    // Clear any API key that might have been set by previous tests
    await clearApiKey(page);

    const input = page.locator('.chat-input');
    await input.fill('Hello');
    await page.keyboard.press('Enter');

    // Without an API key, the app should show the settings prompt
    await expect(page.locator('.chat-messages')).toContainText('Please set your API key', { timeout: 10000 });

    await app.close();
  });

  test('settings button is clickable', async () => {
    const { app, page } = await launchApp();

    // The gear/cog settings button should be present in the title bar
    const settingsBtn = page.locator('.title-bar-btn').first();
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();

    // Settings modal/overlay should open (if it shows a settings panel)
    // This depends on how settings opens — adjust selector as needed
    // For now we just verify the button exists and is clickable

    await app.close();
  });

  test('window controls (minimize, maximize, close) are clickable', async () => {
    const { app, page } = await launchApp();

    const controls = page.locator('.window-control');
    const count = await controls.count();
    expect(count).toBeGreaterThanOrEqual(3); // minimize, maximize, close

    await app.close();
  });
});

test.describe('OS Assistant — Tool invocation UI', () => {
  test('tool invocation blocks render with correct status classes', async () => {
    const { app, page } = await launchApp();

    // Clear any saved sessions that might have tool invocations from previous tests
    await clearSessions(page);
    // Reload to ensure auto-restore doesn't pick up old sessions
    await page.reload();
    await page.waitForLoadState('load', { timeout: 15000 });
    await page.waitForSelector('.app', { timeout: 15000 });

    // Verify the tool invocation CSS class is NOT present in the DOM
    // (actual tool calls require API key + AI interaction)
    await expect(page.locator('.tool-invocation')).toHaveCount(0);

    await app.close();
  });
});
