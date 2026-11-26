// Drive the real nexus TUI in a PTY, mirror it in a headless xterm, and dump
// the screen (chars + colors) after each scripted step as JSON frames.
// usage: npm run build
//        npm i --prefix <xtermPkgDir> @xterm/headless   (kept out of devDependencies)
//        node scripts/readme-shots/capture-tui.cjs <appDir> <xtermPkgDir> <out.json>
//        python scripts/readme-shots/render-tui.py <out.json> <imagesDir>
// Then copy preview.gif, providers-groq.png -> providers.png and
// models-gemini.png -> models.png into docs/images/.
// Runs with an empty NEXUS_DATA_DIR (no keys) and NEXUS_LANG=en, so the shots
// show what a new user sees. On Windows node-pty may print "AttachConsole
// failed" on exit: harmless, the frames are already written.
const { createRequire } = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const [appDir, xtermDir, outFile] = process.argv.slice(2);
const pty = createRequire(path.join(appDir, 'package.json'))('node-pty');
const { Terminal } = createRequire(path.join(xtermDir, 'package.json'))('@xterm/headless');

const COLS = 96, ROWS = 22;
const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-shot-'));
const child = pty.spawn(process.execPath, [path.join(appDir, 'bin', 'nexus.js')], {
  cols: COLS, rows: ROWS, cwd: appDir,
  env: { ...process.env, NEXUS_LANG: 'en', NEXUS_NO_UPDATE_CHECK: '1', NEXUS_DATA_DIR: dataDir, CI: 'false' },
});
child.onData((d) => term.write(d));

function snapshot(label, hold) {
  const buf = term.buffer.active;
  const rows = [];
  for (let y = 0; y < ROWS; y++) {
    const line = buf.getLine(buf.viewportY + y);
    const cells = [];
    for (let x = 0; x < COLS; x++) {
      const c = line?.getCell(x);
      if (!c) { cells.push([' ', -1, -1, 0, 0]); continue; }
      const fg = c.isFgDefault() ? -1 : c.isFgPalette() ? c.getFgColor() : -2;
      const bg = c.isBgDefault() ? -1 : c.isBgPalette() ? c.getBgColor() : -2;
      cells.push([c.getChars() || ' ', fg, bg, c.isBold() ? 1 : 0, c.isDim() ? 1 : 0]);
    }
    rows.push(cells);
  }
  return { label, hold, rows };
}

const DOWN = '\x1b[B', UP = '\x1b[A', LEFT = '\x1b[D';
// [delay before key, key, label, hold ms in the GIF]
const steps = [
  [6000, UP, 'providers', 1600],
  [700, DOWN, null, 450], [700, DOWN, null, 450], [700, DOWN, 'providers-groq', 900],
  [800, '\r', 'models', 2200],
  [800, DOWN, null, 900], [800, DOWN, null, 1400], [800, UP, null, 600], [800, UP, 'models-top', 1200],
  [800, LEFT, null, 700], [700, DOWN, null, 450], [700, DOWN, 'providers-gemini', 800],
  [800, '\r', 'models-gemini', 2400],
];
const frames = [];
(async () => {
  for (const [delay, key, label, hold] of steps) {
    if (key) child.write(key);
    await new Promise((r) => setTimeout(r, delay));
    await new Promise((r) => term.write('', r)); // flush parser
    frames.push(snapshot(label, hold));
  }
  child.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.writeFileSync(outFile, JSON.stringify({ cols: COLS, rows: ROWS, frames }));
  console.log(`frames: ${frames.length}`);
  process.exit(0);
})();
