/**
 * OS Assistant — Full Tool Suite E2E Test
 *
 * Tests ALL 18 tool functions end-to-end by calling preload APIs directly.
 * Each tool test is wrapped individually so a single failure does NOT
 * halt the rest of the suite. Results are collected and reported at the end.
 *
 * Run: npm run test:e2e -- --grep "Full Tool Suite"
 */

import { test, expect, ElectronApplication, Page } from '@playwright/test';
import { launchApp, sendMessage, setApiKey, waitForAssistantSuccess, clearSessions } from './helpers';
import * as path from 'path';
import * as fs from 'fs';

// ── Temp directory for file-ops testing ──
const TEST_OUTPUT_DIR = path.join(__dirname, '..', 'test-output');

interface ToolResult {
  name: string;
  passed: boolean;
  error?: string;
}

/**
 * Remove all files/dirs created during testing.
 * Individual tests handle their own cleanup via this helper.
 */
function cleanupTestOutput(): void {
  if (fs.existsSync(TEST_OUTPUT_DIR)) {
    fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
}

const hasApiKey = !!process.env.TEST_DEEPSEEK_API_KEY;

test.describe('OS Assistant — Full Tool Suite', () => {
  test.skip(!hasApiKey, 'TEST_DEEPSEEK_API_KEY is not set — skipping full tool suite');

  // Use longer timeout — we're testing 18 things
  test.setTimeout(180_000);

  let app: ElectronApplication;
  let page: Page;
  const results: ToolResult[] = [];

  /**
   * Helper: run a tool test section without stopping the suite on failure.
   * Each test is scoped to a single tool function.
   */
  async function testTool(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`  ✅ ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name, passed: false, error: msg });
      console.log(`  ❌ ${name}: ${msg}`);
    }
  }

  /** Eval in-page — passes args through to page.evaluate */
  async function pageEval<T, A = unknown>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> {
    return page.evaluate(fn, arg as any);
  }

  test.beforeAll(async () => {
    // Clean up any leftovers from previous runs
    cleanupTestOutput();
  });

  test.beforeEach(async () => {
    // Launch once per suite
  });

  test('all 18 tools work end-to-end via direct API calls', async () => {
    // ── Launch ──
    ({ app, page } = await launchApp());

    // Set API key so the app can use AI (needed for some tool flows)
    const apiKey = process.env.TEST_DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('TEST_DEEPSEEK_API_KEY is required — set it in .env or as env var');
    }
    await setApiKey(page, apiKey);
    await clearSessions(page);

    // Ensure a terminal is available for terminal-dependent tools
    await pageEval(async () => {
      await window.terminalAPI.create();
    });

    // ════════════════════════════════════════════════════════════════
    // SECTION 1: File System Tools (aiToolsAPI)
    // ════════════════════════════════════════════════════════════════

    const testRoot = TEST_OUTPUT_DIR.replace(/\\/g, '/');
    const testSubDir = path.join(TEST_OUTPUT_DIR, 'nested', 'sub').replace(/\\/g, '/');
    const testFile = path.join(TEST_OUTPUT_DIR, 'test-file.txt').replace(/\\/g, '/');
    const initialContent = 'Hello World!\nThis is a test file.';

    // ── 1. create_directory ──
    await testTool('create_directory', async () => {
      const r = await pageEval(async (dirPath: string) => {
        return window.aiToolsAPI.createDirectory(dirPath);
      }, testSubDir);
      expect(r.success).toBe(true);
      // Verify it actually exists
      expect(fs.existsSync(testSubDir)).toBe(true);
    });

    // ── 2. write_file ──
    await testTool('write_file', async () => {
      const r = await pageEval(async ({ filePath, content }: { filePath: string; content: string }) => {
        return window.aiToolsAPI.writeFile(filePath, content);
      }, { filePath: testFile, content: initialContent });
      expect(r.success).toBe(true);
      expect(fs.readFileSync(testFile, 'utf-8')).toBe(initialContent);
    });

    // ── 3. read_file ──
    await testTool('read_file', async () => {
      const r = await pageEval(async (filePath: string) => {
        return window.aiToolsAPI.readFile(filePath);
      }, testFile);
      expect(r.success).toBe(true);
      expect(r.content).toBe(initialContent);
    });

    // ── 4. edit_file ──
    await testTool('edit_file', async () => {
      const r = await pageEval(async ({ filePath, oldText, newText }: { filePath: string; oldText: string; newText: string }) => {
        return window.aiToolsAPI.editFile(filePath, oldText, newText);
      }, { filePath: testFile, oldText: 'Hello World', newText: 'Hi Universe' });
      expect(r.success).toBe(true);
      const updated = fs.readFileSync(testFile, 'utf-8');
      expect(updated).toContain('Hi Universe');
      expect(updated).toContain('This is a test file.');
    });

    // ── 5. copy_file ──
    const copyDest = path.join(TEST_OUTPUT_DIR, 'test-file-copy.txt').replace(/\\/g, '/');
    await testTool('copy_file', async () => {
      const r = await pageEval(async ({ src, dst }: { src: string; dst: string }) => {
        return window.aiToolsAPI.copyFile(src, dst);
      }, { src: testFile, dst: copyDest });
      expect(r.success).toBe(true);
      expect(fs.existsSync(copyDest)).toBe(true);
      expect(fs.readFileSync(copyDest, 'utf-8')).toBe(fs.readFileSync(testFile, 'utf-8'));
    });

    // ── 6. move_file (rename) ──
    const movedDest = path.join(TEST_OUTPUT_DIR, 'test-file-moved.txt').replace(/\\/g, '/');
    await testTool('move_file', async () => {
      const r = await pageEval(async ({ src, dst }: { src: string; dst: string }) => {
        return window.aiToolsAPI.renameFile(src, dst);
      }, { src: copyDest, dst: movedDest });
      expect(r.success).toBe(true);
      expect(fs.existsSync(movedDest)).toBe(true);
      expect(fs.existsSync(copyDest)).toBe(false);
    });

    // ── 7. delete_file ──
    await testTool('delete_file', async () => {
      const r = await pageEval(async (filePath: string) => {
        return window.aiToolsAPI.deleteFile(filePath);
      }, movedDest);
      expect(r.success).toBe(true);
      expect(fs.existsSync(movedDest)).toBe(false);
    });

    // ── 8. list_directory ──
    await testTool('list_directory', async () => {
      const r = await pageEval(async (dirPath: string) => {
        return window.aiToolsAPI.listDirectory(dirPath);
      }, testRoot);
      expect(r.success).toBe(true);
      expect(r.entries.length).toBeGreaterThan(0);
      const names = r.entries.map((e: { name: string }) => e.name);
      expect(names).toContain('test-file.txt');
      expect(names).toContain('nested');
    });

    // ── 9. search_in_files ──
    await testTool('search_in_files', async () => {
      const r = await pageEval(async ({ rootPath, pattern }: { rootPath: string; pattern: string }) => {
        return window.aiToolsAPI.searchInFiles(rootPath, pattern);
      }, { rootPath: testRoot, pattern: 'Universe' });
      expect(r.success).toBe(true);
      expect(r.results.length).toBeGreaterThanOrEqual(1);
      const match = r.results.find((res: { content: string }) => res.content.includes('Hi Universe'));
      expect(match).toBeTruthy();
    });

    // ════════════════════════════════════════════════════════════════
    // SECTION 2: System Information
    // ════════════════════════════════════════════════════════════════

    // ── 10. get_system_info ──
    await testTool('get_system_info', async () => {
      const info = await pageEval(async () => {
        return window.systemAPI.getInfo();
      });
      expect(info).toBeDefined();
      expect(info.os).toBeTruthy();
      expect(info.architecture).toBeTruthy();
      expect(info.hostname).toBeTruthy();
      expect(info.username).toBeTruthy();
      expect(info.cpu).toBeTruthy();
      expect(info.totalRamGB).toBeGreaterThan(0);
      expect(info.cpuCores).toBeGreaterThan(0);
    });

    // ════════════════════════════════════════════════════════════════
    // SECTION 3: Terminal Tools
    // ════════════════════════════════════════════════════════════════

    // ── 11. execute_command ──
    await testTool('execute_command', async () => {
      const r = await pageEval(async () => {
        return window.terminalAPI.executeAndCapture('echo "TOOL_TEST_OK"');
      });
      expect(r.success).toBe(true);
      expect(r.output).toContain('TOOL_TEST_OK');
    });

    // ── 12. inject_terminal ──
    await testTool('inject_terminal', async () => {
      const r = await pageEval(async () => {
        return window.terminalAPI.injectCommand('echo "INJECTED"');
      });
      expect(r.success).toBe(true);
    });

    // ── 13. read_terminal_output ──
    await testTool('read_terminal_output', async () => {
      const output = await pageEval(async () => {
        return window.terminalAPI.readBuffer(20);
      });
      // Should at least be a non-null string (may be empty if buffer cleared)
      expect(typeof output).toBe('string');
    });

    // ── 14. measure_bandwidth (lightweight version) ──
    await testTool('measure_bandwidth', async () => {
      // Use a smaller test than the default 10MB — ping-based connectivity check
      const r = await pageEval(async () => {
        return window.terminalAPI.executeAndCapture(
          'curl -s --connect-timeout 5 --max-time 10 -o NUL -w "dl_speed=%{speed_download}" http://speedtest.tele2.net/1MB.zip'
        );
      });
      expect(r.success).toBe(true);
      expect(r.output).toContain('dl_speed=');
    });

    // ════════════════════════════════════════════════════════════════
    // SECTION 4: Memory / Notes Tools
    // ════════════════════════════════════════════════════════════════

    const testNoteKey = 'e2e-test-note';
    const testNoteValue = 'This note was created by the E2E full-suite test.';

    // ── 15. save_note ──
    await testTool('save_note', async () => {
      const r = await pageEval(async ({ key, value }: { key: string; value: string }) => {
        return window.memoryAPI.saveNote(key, value);
      }, { key: testNoteKey, value: testNoteValue });
      expect(r).toBe(true);
    });

    // ── 16. read_notes ──
    await testTool('read_notes', async () => {
      const notes = await pageEval(async () => {
        return window.memoryAPI.getAllNotes();
      });
      expect(notes[testNoteKey]).toBe(testNoteValue);
    });

    // ── 17. delete_note ──
    await testTool('delete_note', async () => {
      const r = await pageEval(async (key: string) => {
        return window.memoryAPI.deleteNote(key);
      }, testNoteKey);
      expect(r).toBe(true);
      const notes = await pageEval(async () => {
        return window.memoryAPI.getAllNotes();
      });
      expect(notes[testNoteKey]).toBeUndefined();
    });

    // ════════════════════════════════════════════════════════════════
    // SECTION 5: AI-Powered Workflow (fetch_url + end-to-end AI flow)
    // ════════════════════════════════════════════════════════════════

    // ── 18. fetch_url ──
    await testTool('fetch_url', async () => {
      const r = await pageEval(async (url: string) => {
        return window.aiToolsAPI.fetchUrl(url);
      }, 'https://httpbin.org/get');
      expect(r.success).toBe(true);
      expect(r.content).toBeTruthy();
      expect(r.content.length).toBeGreaterThan(10);
    });

    // ── 19. Full AI conversation trigger (uses AI provider → tool execution chain) ──
    await testTool('ai_conversation_flow', async () => {
      await sendMessage(page, 'Check connectivity: ping google.com -n 2 and tell me the results');
      const response = await waitForAssistantSuccess(page, 60_000);
      expect(response.length).toBeGreaterThan(10);
    });

    // ════════════════════════════════════════════════════════════════
    // REPORT
    // ════════════════════════════════════════════════════════════════
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    const total = results.length;

    console.log('\n═══════════════════════════════════════');
    console.log(`  TOOL SUITE RESULTS: ${passed}/${total} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════');

    if (failed > 0) {
      console.log('\n  FAILURES:');
      for (const r of results.filter((r) => !r.passed)) {
        console.log(`    ❌ ${r.name}: ${r.error}`);
      }
    }
    console.log('═══════════════════════════════════════\n');

    // If we want the test to report which tools failed but not block others,
    // we assert at the end. soft expect allows collecting all failures.
    test.expect(failed, `Tool failures: ${failed}, see console for details`).toBe(0);

    // Cleanup
    cleanupTestOutput();
    await app.close();
  });
});
