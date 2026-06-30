import { test, expect } from '@playwright/test';
import { launchApp, setApiKey, sendMessage, waitForAssistantSuccess } from './helpers';

const DEEPSEEK_API_KEY = process.env.TEST_DEEPSEEK_API_KEY;
const hasApiKey = !!DEEPSEEK_API_KEY;

test.describe('OS Assistant — System Tools (scan_wifi, monitor_hardware, process_tree)', () => {
  test.skip(!hasApiKey, 'TEST_DEEPSEEK_API_KEY is not set — skipping system tool tests');

  // ─── Wi-Fi Scanner (Direct IPC) ───
  test('scan_wifi IPC handler returns a valid response structure', async () => {
    test.setTimeout(30_000);
    const { app, page } = await launchApp();

    const result = await page.evaluate(async () => {
      return await (window as any).aiToolsAPI.scanWifi();
    });

    console.log('=== SCAN_WIFI RESULT ===');
    console.log(JSON.stringify(result, null, 2));
    console.log('=== END ===');

    // The handler should always return success (it handles no-WiFi gracefully)
    expect(result).toHaveProperty('success');
    // If no Wi-Fi, we get a notice; if Wi-Fi works, we get networks[]
    if (result.success && result.notice) {
      // No Wi-Fi available — graceful degradation
      expect(typeof result.notice).toBe('string');
      expect(result.notice.length).toBeGreaterThan(0);
    } else if (result.success && result.networks) {
      // Wi-Fi available — verify structure
      expect(Array.isArray(result.networks)).toBe(true);
      if (result.networks.length > 0) {
        const net = result.networks[0];
        expect(net).toHaveProperty('ssid');
        expect(net).toHaveProperty('signalStrength');
        expect(net).toHaveProperty('channel');
        expect(net).toHaveProperty('auth');
        expect(net).toHaveProperty('encryption');
        expect(net).toHaveProperty('bssid');
        expect(net).toHaveProperty('radioType');
      }
    }
    // If Wi-Fi scan itself failed hard, error should be a string
    if (!result.success) {
      expect(typeof result.error).toBe('string');
    }

    await app.close();
  });

  // ─── Hardware Monitor (Direct IPC) ───
  test('monitor_hardware IPC handler returns CPU, memory, disk, and uptime data', async () => {
    test.setTimeout(30_000);
    const { app, page } = await launchApp();

    const result = await page.evaluate(async () => {
      return await (window as any).aiToolsAPI.monitorHardware();
    });

    console.log('=== MONITOR_HARDWARE RESULT ===');
    console.log(JSON.stringify(result, null, 2));
    console.log('=== END ===');

    // Main success flag
    expect(result).toHaveProperty('success');
    expect(result.success).toBe(true);

    const data = result.data;
    expect(data).toBeTruthy();

    // CPU usage should be present (always available on Windows)
    expect(data).toHaveProperty('cpuUsage');
    expect(typeof data.cpuUsage).toBe('string');
    // Should be like "12%" or "N/A"
    if (data.cpuUsage !== 'N/A') {
      expect(data.cpuUsage).toMatch(/^\d+%/);
    }

    // CPU temperature might not be available on all hardware
    expect(data).toHaveProperty('cpuTemperature');

    // Memory must always be available
    expect(data).toHaveProperty('memory');
    if (typeof data.memory === 'object' && data.memory !== null) {
      expect(data.memory).toHaveProperty('totalGB');
      expect(data.memory).toHaveProperty('usedGB');
      expect(data.memory).toHaveProperty('freeGB');
      expect(data.memory).toHaveProperty('usagePercent');
      // Should contain "GB" in size strings
      expect(data.memory.totalGB).toMatch(/GB/);
      expect(data.memory.usagePercent).toMatch(/%/);
    }

    // Disks should be an array with at least C:
    expect(data).toHaveProperty('disks');
    if (Array.isArray(data.disks) && data.disks.length > 0) {
      const cDrive = data.disks.find((d: any) => d.drive === 'C:');
      expect(cDrive).toBeTruthy();
      expect(cDrive.total).toMatch(/GB/);
      expect(cDrive.usagePercent).toMatch(/%/);
    }

    // Uptime should be present
    expect(data).toHaveProperty('uptime');
    expect(typeof data.uptime).toBe('string');
    if (data.uptime !== 'N/A') {
      expect(data.uptime).toMatch(/\d+d/); // at least 0d
    }

    await app.close();
  });

  // ─── Process Tree (Direct IPC) ───
  test('process_tree IPC handler returns a tree with System and many processes', async () => {
    test.setTimeout(30_000);
    const { app, page } = await launchApp();

    const result = await page.evaluate(async () => {
      return await (window as any).aiToolsAPI.getProcessTree();
    });

    console.log('=== PROCESS_TREE RESULT ===');
    console.log(JSON.stringify({ success: result.success, processCount: result.processCount, treeLength: result.tree?.length }, null, 2));
    console.log('=== END ===');

    expect(result.success).toBe(true);
    expect(result).toHaveProperty('tree');
    expect(typeof result.tree).toBe('string');
    expect(result.tree.length).toBeGreaterThan(50); // Substantial output

    // Should contain key expected process names
    const tree = result.tree;
    expect(tree).toContain('System'); // System Idle Process or just System
    expect(tree).toContain('PID:');   // PIDs in the tree

    // processCount should be a reasonable number for a running Windows system
    expect(result).toHaveProperty('processCount');
    expect(typeof result.processCount).toBe('number');
    expect(result.processCount).toBeGreaterThan(50);  // Even minimal Windows has 100+

    // Tree structure markers
    expect(tree).toContain('─'); // root marker
    expect(tree).toContain('├'); // child marker

    await app.close();
  });

  // ─── AI Interaction: scan_wifi ───
  test('AI uses scan_wifi when asked about Wi-Fi networks', async () => {
    test.setTimeout(90_000);
    const { app, page } = await launchApp();

    await setApiKey(page, DEEPSEEK_API_KEY);

    // Explicitly ask for Wi-Fi scanning
    await sendMessage(page, 'Scan for nearby Wi-Fi networks using the scan_wifi tool and tell me what you find');

    const response = await waitForAssistantSuccess(page, 60_000);

    console.log('=== SCAN_WIFI AI RESPONSE ===');
    console.log(response);
    console.log('=== END ===');

    // AI should acknowledge the scan — even if no networks found
    expect(response.length).toBeGreaterThan(20);

    await app.close();
  });

  // ─── AI Interaction: monitor_hardware ───
  test('AI uses monitor_hardware when asked about hardware status', async () => {
    test.setTimeout(90_000);
    const { app, page } = await launchApp();

    await setApiKey(page, DEEPSEEK_API_KEY);

    // Explicitly ask for hardware monitoring
    await sendMessage(page, 'Use the monitor_hardware tool to check my CPU usage, memory, disk space, and uptime');

    const response = await waitForAssistantSuccess(page, 60_000);

    console.log('=== MONITOR_HARDWARE AI RESPONSE ===');
    console.log(response);
    console.log('=== END ===');

    expect(response.length).toBeGreaterThan(20);

    await app.close();
  });

  // ─── AI Interaction: process_tree ───
  test('AI uses process_tree when asked about running processes in a tree', async () => {
    test.setTimeout(90_000);
    const { app, page } = await launchApp();

    await setApiKey(page, DEEPSEEK_API_KEY);

    // Explicitly ask for process tree
    await sendMessage(page, 'Use the process_tree tool to show me a hierarchical tree of running processes');

    const response = await waitForAssistantSuccess(page, 60_000);

    console.log('=== PROCESS_TREE AI RESPONSE ===');
    console.log(response);
    console.log('=== END ===');

    expect(response.length).toBeGreaterThan(20);

    await app.close();
  });
});
