#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const cmd = (process.argv[2] || 'help').toLowerCase();
const rest = process.argv.slice(3);

function runPowerShell(script, args = []) {
  const scriptPath = path.join(root, script);
  const ps = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], {
    stdio: 'inherit',
    shell: false,
  });
  process.exit(result.status ?? 1);
}

switch (cmd) {
  case 'install':
    runPowerShell('install.ps1', rest);
    break;
  case 'update':
    runPowerShell('update.ps1', rest);
    break;
  case 'uninstall':
    runPowerShell('uninstall.ps1', rest);
    break;
  case 'help':
  default:
    console.log(`Nexus Switch\n\nUsage:\n  npx @hexanexus/nexus-switch install\n  npx @hexanexus/nexus-switch update\n  npx @hexanexus/nexus-switch uninstall\n\nAfter install:\n  . $PROFILE\n  nexus doctor\n  nexus\n`);
}
