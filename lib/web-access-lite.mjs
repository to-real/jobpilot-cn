import { existsSync, readFileSync, readdirSync } from 'fs';
import { spawn } from 'child_process';
import net from 'net';
import os from 'os';
import path from 'path';
import { chromium } from 'playwright';

export const DEFAULT_CDP_PORTS = [9222, 9229, 9333];

export function loginRiskWarning() {
  return [
    'Warning: Chrome login mode uses your real browser session.',
    'Some job platforms may detect automation and limit or block accounts.',
    'This project only reads job search/detail pages and must not apply, chat, or submit forms.',
  ].join('\n');
}

export function activePortFiles() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || '';

  if (process.platform === 'win32') {
    return [
      path.join(localAppData, 'Google', 'Chrome', 'User Data', 'DevToolsActivePort'),
      path.join(localAppData, 'Chromium', 'User Data', 'DevToolsActivePort'),
    ];
  }

  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'DevToolsActivePort'),
      path.join(home, 'Library', 'Application Support', 'Google', 'Chrome Canary', 'DevToolsActivePort'),
      path.join(home, 'Library', 'Application Support', 'Chromium', 'DevToolsActivePort'),
    ];
  }

  return [
    path.join(home, '.config', 'google-chrome', 'DevToolsActivePort'),
    path.join(home, '.config', 'chromium', 'DevToolsActivePort'),
  ];
}

export function readChromePortsFromDisk() {
  const ports = [];
  for (const filePath of activePortFiles()) {
    if (!existsSync(filePath)) continue;
    try {
      const [line] = readFileSync(filePath, 'utf-8').trim().split(/\r?\n/);
      const port = Number(line);
      if (Number.isInteger(port) && port > 0 && port < 65536) {
        ports.push(port);
      }
    } catch {
      // Ignore unreadable Chrome state files.
    }
  }
  return ports;
}

export function listSitePatterns(patternsDir = path.join('references', 'site-patterns')) {
  try {
    return readdirSync(patternsDir)
      .filter((file) => file.endsWith('.md'))
      .map((file) => file.replace(/\.md$/, ''));
  } catch {
    return [];
  }
}

export function openChromeRemoteDebuggingSettings() {
  const url = 'chrome://inspect/#remote-debugging';
  const candidates = [];

  if (process.platform === 'win32') {
    const programFiles = [
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    for (const root of programFiles) {
      candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else {
    candidates.push('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser');
  }

  for (const executable of candidates) {
    try {
      const child = spawn(executable, [url], {
        detached: true,
        stdio: 'ignore',
        ...(process.platform === 'win32' ? { windowsHide: false } : {}),
      });
      child.unref();
      return true;
    } catch {
      // Try the next common Chrome executable.
    }
  }

  if (process.platform === 'win32') {
    try {
      const child = spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

export function checkPort(port, host = '127.0.0.1', timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });

    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export async function isChromeDebugPort(port) {
  if (!await checkPort(port)) return false;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return Boolean(json.Browser || json.webSocketDebuggerUrl);
  } catch {
    return false;
  }
}

export async function detectChromeDebugPort(extraPorts = []) {
  const candidates = [
    ...readChromePortsFromDisk(),
    ...extraPorts,
    ...DEFAULT_CDP_PORTS,
  ];
  const seen = new Set();

  for (const port of candidates) {
    if (seen.has(port)) continue;
    seen.add(port);
    if (await isChromeDebugPort(port)) return port;
  }

  return null;
}

export async function fetchChromeTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Chrome DevTools HTTP ${res.status}`);
  return res.json();
}

export async function connectToChrome({ port } = {}) {
  const detectedPort = port || await detectChromeDebugPort();
  if (!detectedPort) {
    throw new Error('Chrome remote debugging is not available. Open chrome://inspect/#remote-debugging and enable remote debugging, then restart Chrome if needed.');
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${detectedPort}`);
  return { browser, port: detectedPort };
}

export async function createPublicBrowser() {
  return chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
}
