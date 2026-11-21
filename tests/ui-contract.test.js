'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('src/app/app.js', 'utf8');
const css = fs.readFileSync('assets/style.css', 'utf8');

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'HTML IDs must be unique.');
const idSet = new Set(ids);
const literalRefs = [...app.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
for (const id of new Set(literalRefs)) assert(idSet.has(id), `App references missing HTML id: ${id}`);

const drawerStart = html.indexOf('<aside class="side-drawer"');
const drawerEnd = html.indexOf('</aside>', drawerStart);
assert(drawerStart >= 0 && drawerEnd > drawerStart, 'Pet drawer must exist.');
const drawer = html.slice(drawerStart, drawerEnd);
assert(drawer.indexOf('PERSONALITY') < drawer.indexOf('CHALLENGES'), 'Personality must appear before challenge links.');
assert.equal((drawer.match(/class="challenge-link"/g) || []).length, 2, 'Hamburger should contain only Arena and Friends Challenge.');
assert(drawer.includes('Arena') && drawer.includes('Friends Challenge'), 'Both challenge destinations must exist.');

for (const item of ['leaderboard', 'pets', 'bond', 'save', 'settings', 'about', 'technical']) {
  assert(html.includes(`data-open-workspace="${item}"`), `Overflow menu is missing ${item}.`);
}
assert(html.includes('href="https://prasannaone.github.io/"'), 'Header heart must link to the personal website.');

const boardStart = html.indexOf('<main class="game-stage"');
const boardEnd = html.indexOf('</main>', boardStart);
const board = html.slice(boardStart, boardEnd);
assert(!/newGameBtn|undoBtn|New game|Undo/i.test(board), 'Board must not contain New Game or Undo controls.');
assert(html.includes('id="matchResultDialog"') && html.includes('MATCH COMPLETE'), 'Completed matches need an explicit result dialog.');
assert(html.includes('id="resultReason"') && html.includes('id="nextMatchBtn"'), 'Match result must include the ending reason and Next match action.');
assert(app.includes('function finishMatch(') && app.includes("$('resultReason').textContent=reason"), 'Game completion must report its actual terminal reason.');
assert(css.includes('overflow:hidden') && css.includes('100dvh'), 'Main app shell must prevent page scrolling on supported devices.');

console.log('Chelo UI contract passed: personality-first challenge drawer, overflow destinations, board controls, no-scroll shell and explicit match completion.');
