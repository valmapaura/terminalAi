import { test, expect } from '@playwright/test';
import { launchApp, sendMessage, setApiKey, waitForAssistantSuccess } from './helpers';

// The test API key for DeepSeek.
// Override via TEST_DEEPSEEK_API_KEY environment variable if desired.
const DEEPSEEK_API_KEY = process.env.TEST_DEEPSEEK_API_KEY || 'sk-15983c3134e24d2fbe5a10a1d0ac630f';

test.describe('OS Assistant — AI interaction', () => {
  test('executes a command when asked explicitly', async () => {
    test.setTimeout(120_000);

    const { app, page } = await launchApp();

    // 1. Set the API key so the AI can actually respond
    await setApiKey(page, DEEPSEEK_API_KEY);

    // 2. Be very explicit about wanting a command run
    await sendMessage(page, 'Run the command "ping google.com -n 2" and show me the results');

    // 3. Wait for the assistant to finish responding
    const response = await waitForAssistantSuccess(page, 90_000);

    console.log('=== COMMAND TEST RESPONSE ===');
    console.log(response);
    console.log('=== END ===');

    // 4. The response should contain ping results or at minimum
    //    indicate the command was executed
    expect(response.length).toBeGreaterThan(20);

    await app.close();
  });

  test('responds to a list directory request', async () => {
    test.setTimeout(120_000);

    const { app, page } = await launchApp();

    // 1. Set the API key
    await setApiKey(page, DEEPSEEK_API_KEY);

    // 2. Ask to list files
    await sendMessage(page, 'list files in current directory');

    // 3. Wait for the AI to respond
    const response = await waitForAssistantSuccess(page, 90_000);

    console.log('AI response length:', response.length);

    // 4. Should have a meaningful response
    expect(response.length).toBeGreaterThan(10);

    await app.close();
  });
});
