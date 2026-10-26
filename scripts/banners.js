// Renders assets/banner.html to PNG with headless Chrome. Run: npm run banners
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BANNERS = {
  help: ['Demobot', 'Tickets, verification, moderation and more'],
  verify: ['Verification', 'Confirm you are human to unlock the server'],
  support: ['Support', 'Private tickets with the staff team'],
  roles: ['Roles', 'Pick the roles that fit you'],
  welcome: ['Welcome', 'We are glad you are here'],
  giveaway: ['Giveaway', 'Press Enter for a chance to win'],
  applications: ['Applications', 'Tell us about yourself'],
};

const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(p => p && existsSync(p));
if (!chrome) throw new Error('Chrome or Edge not found. Set CHROME_PATH.');

const template = pathToFileURL(resolve('assets/banner.html')).href;

function shot(query, out, width, height) {
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
    `--window-size=${width},${height}`, `--screenshot=${resolve(out)}`, `${template}?${new URLSearchParams(query)}`,
  ], { stdio: 'ignore' });
  console.log(`Rendered ${out}`);
}

mkdirSync('assets/banners', { recursive: true });
for (const [name, [t, s]] of Object.entries(BANNERS)) shot({ t, s, i: name }, `assets/banners/${name}.png`, 1200, 400);
shot({ mode: 'avatar' }, 'assets/avatar.png', 512, 512);
