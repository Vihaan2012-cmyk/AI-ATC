// Stage exactly the runtime files the packaged app needs into app/staging/.
// electron-builder then copies staging/brain -> resources/brain and staging/widget -> resources/widget.
//
// Layout produced (matches main.js packaged paths):
//   staging/brain/dist/brain/serve.js      (compiled brain)
//   staging/brain/node_modules/...         (runtime deps only: node-simconnect, ws + transitive)
//   staging/brain/.env.example             (ensureEnv copies this to .env on first run)
//   staging/widget/atc-widget.html
//
// Run via: npm run dist  (which calls `node build-resources.js` first)
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const appDir = __dirname;
const repoRoot = path.join(appDir, '..');
const staging = path.join(appDir, 'staging');
const brainOut = path.join(staging, 'brain');
const widgetOut = path.join(staging, 'widget');

function log(m) { process.stdout.write(`[build-resources] ${m}\n`); }
function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }
function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }
function copyDir(from, to) { mkdir(to); fs.cpSync(from, to, { recursive: true }); }

// 1) Clean staging.
log('cleaning staging/');
rm(staging);
mkdir(brainOut);
mkdir(widgetOut);

// 2) Compile the brain to dist/brain/*.js.
log('compiling brain (tsc -p tsconfig.build.json)');
execSync('npx tsc -p tsconfig.build.json', { cwd: repoRoot, stdio: 'inherit' });

// 3) Stage the compiled output.
log('staging dist/');
copyDir(path.join(repoRoot, 'dist'), path.join(brainOut, 'dist'));

// 4) Install ONLY runtime deps into staging/brain (keeps the build lean — no tsx/typescript/esbuild).
const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const brainPkg = {
  name: 'msfs-ai-atc-brain',
  version: rootPkg.version || '0.0.0',
  private: true,
  type: 'module',
  dependencies: rootPkg.dependencies || {},
};
fs.writeFileSync(path.join(brainOut, 'package.json'), JSON.stringify(brainPkg, null, 2));
log('installing runtime deps (npm install --omit=dev) in staging/brain');
execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock', { cwd: brainOut, stdio: 'inherit' });

// 5) Ship .env.example so the app can seed .env on first run.
const envExample = path.join(repoRoot, '.env.example');
if (fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, path.join(brainOut, '.env.example'));
  log('staged .env.example');
} else {
  log('WARNING: .env.example not found at repo root');
}

// 6) Stage the widget.
log('staging widget/');
copyDir(path.join(repoRoot, 'widget'), widgetOut);
// Drop the legacy in-sim package from the widget copy if present (not needed in the desktop build).
rm(path.join(widgetOut, 'msfs-package'));

log('done. staging/ ready for electron-builder.');
