#!/usr/bin/env node

/**
 * Lightweight browser access preflight for career-ops.
 *
 * Inspired by eze-is/web-access (MIT), but implemented in-project with the
 * existing Playwright dependency instead of requiring a separate agent skill.
 */

import {
  detectChromeDebugPort,
  fetchChromeTargets,
  listSitePatterns,
  openChromeRemoteDebuggingSettings,
} from './lib/web-access-lite.mjs';

async function main() {
  const openSettings = process.argv.includes('--open-settings') || process.env.npm_config_open_settings === 'true';
  const major = Number(process.versions.node.split('.')[0]);
  console.log(`node: ${major >= 22 ? 'ok' : 'warn'} (v${process.versions.node}, recommended v22+)`);

  const port = await detectChromeDebugPort();
  if (!port) {
    console.log('chrome: not connected');
    console.log('Open chrome://inspect/#remote-debugging in Chrome, enable "Allow remote debugging for this browser instance", then retry.');
    console.log('You can also run: npm run web:check -- --open-settings');
    if (openSettings) {
      const opened = openChromeRemoteDebuggingSettings();
      console.log(opened ? 'opened: Chrome remote debugging settings page' : 'opened: failed to open Chrome automatically');
    }
    process.exit(1);
  }

  console.log(`chrome: ok (port ${port})`);

  try {
    const version = await fetchChromeTargets(port);
    console.log(`cdp: ok (${version.Browser || 'Chrome'})`);
  } catch (err) {
    console.log(`cdp: error (${err.message})`);
    process.exit(1);
  }

  const patterns = listSitePatterns();
  if (patterns.length) {
    console.log(`site-patterns: ${patterns.join(', ')}`);
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
