import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Auto-load .env file if TEST_DEEPSEEK_API_KEY is not already set.
 * This avoids needing the dotenv dependency — simple line-by-line parser.
 */
function loadEnv(): void {
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
}

loadEnv();

/**
 * Launch the Electron app for testing.
 * Assumes the app has already been built (dist/ exists).
 */
export async function launchApp(): Promise<{
  app: ElectronApplication;
  page: Page;
}> {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'dist', 'main', 'main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  // Wait for the first BrowserWindow to open
  const page = await app.firstWindow();
  // Wait for the page to fully load (React render)
  await page.waitForLoadState('load', { timeout: 15000 });
  await page.waitForSelector('.app', { timeout: 15000 });

  return { app, page };
}

/**
 * Wait for the AI to finish responding after a user message.
 * Uses the `streaming` class on `.chat-input-wrapper` — the AI is done when
 * the class has been ABSENT for 2 consecutive polls (to handle the brief gap
 * between tool_calls finish and the recursive follow-up call).
 * Returns the text of the LAST assistant message.
 */
export async function waitForAssistantResponse(page: Page, timeout = 60000): Promise<string> {
  const deadline = Date.now() + timeout;

  // Wait for at least one assistant message to appear (streaming has started)
  await page.waitForSelector('.message-assistant', { timeout: 15000 });

  let notStreamingCount = 0;
  while (Date.now() < deadline) {
    const wrapper = page.locator('.chat-input-wrapper');
    const hasStreamingClass = await wrapper.evaluate((el) => el.classList.contains('streaming'));
    if (!hasStreamingClass) {
      notStreamingCount++;
      // Require 2 consecutive "not streaming" observations (~600ms apart)
      // to ensure we're past the brief gap between tool_calls and recursive follow-up
      if (notStreamingCount >= 2) {
        await page.waitForTimeout(500); // let React finalize
        break;
      }
    } else {
      notStreamingCount = 0; // still streaming, reset counter
    }
    await page.waitForTimeout(600);
  }

  const msgs = page.locator('.message-assistant');
  const count = await msgs.count();
  if (count === 0) return '';
  return (await msgs.last().textContent()) || '';
}

/**
 * Type text into the chat input and send it.
 */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.locator('.chat-input');
  await input.fill(text);
  await page.keyboard.press('Enter');
}

/**
 * Set the DeepSeek API key in the running app via the preload API.
 * Reloads the page so the React app re-initializes with the key.
 */
export async function setApiKey(page: Page, apiKey: string): Promise<void> {
  await page.evaluate(async (key) => {
    await (window as any).providerAPI.setConfig('deepseek', {
      apiKey: key,
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    });
    await (window as any).providerAPI.setActive('deepseek');
  }, apiKey);

  // Reload the page so the React useEffect picks up the config
  await page.reload();
  await page.waitForLoadState('load', { timeout: 15000 });
  await page.waitForSelector('.app', { timeout: 15000 });
  // Wait for React to fully render chat UI
  await page.waitForSelector('.chat-messages', { timeout: 10000 });
  await page.waitForSelector('.chat-input', { timeout: 5000 });
}

/**
 * Clear the stored API key/config so the app starts without one.
 */
export async function clearApiKey(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await (window as any).providerAPI.setConfig('deepseek', { apiKey: '', baseUrl: '', model: '' });
    await (window as any).providerAPI.setActive('deepseek');
  });
  await page.reload();
  await page.waitForLoadState('load', { timeout: 15000 });
  await page.waitForSelector('.app', { timeout: 15000 });
  await page.waitForSelector('.chat-messages', { timeout: 10000 });
  await page.waitForSelector('.chat-input', { timeout: 5000 });
}

/**
 * Delete all saved chat sessions so the app starts fresh.
 */
export async function clearSessions(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const sessions = await (window as any).chatAPI.listSessions();
    for (const s of sessions) {
      await (window as any).chatAPI.deleteSession(s.id);
    }
  });
}

/**
 * Wait for the AI assistant to finish streaming and verify no error.
 */
export async function waitForAssistantSuccess(page: Page, timeout = 60000): Promise<string> {
  // Wait for the AI to respond
  const text = await waitForAssistantResponse(page, timeout);
  // Check it's not an error message
  if (text.includes('Please set your API key') || text.includes('Error:')) {
    throw new Error(`AI returned an error: ${text}`);
  }
  return text;
}

export type { ElectronApplication, Page };
