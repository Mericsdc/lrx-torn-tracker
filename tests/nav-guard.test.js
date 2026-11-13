const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createNavigationGuard } = require('../src/main/nav-guard');

const clocked = (opts = {}) => {
  const clock = { t: 1_000_000 };
  return { clock, guard: createNavigationGuard({ now: () => clock.t, ...opts }) };
};

test('a burst of more than six navigations in 2.5 s is stopped, then normal browsing works again', () => {
  const { clock, guard } = clocked();
  for (let i = 0; i < 6; i++) { assert.equal(guard.navigate(), null); clock.t += 100; }
  assert.deepEqual(guard.navigate(), { kind: 'fast', report: true });
  assert.deepEqual(guard.navigate(), { kind: 'fast', report: false }, 'one notice per loop');
  clock.t += 3000;
  guard.input('mouseDown');
  assert.equal(guard.navigate(), null);
});

test('a page redirecting every 2 s with nobody touching it is stopped on the ninth navigation', () => {
  const { clock, guard } = clocked();
  for (let i = 0; i < 8; i++) { assert.equal(guard.navigate(), null, `navigation ${i + 1}`); clock.t += 2000; }
  assert.deepEqual(guard.navigate(), { kind: 'slow', report: true });
  clock.t += 2000;
  assert.deepEqual(guard.navigate(), { kind: 'slow', report: false });
  guard.input('mouseMove'); // moving the mouse is not touching the page
  clock.t += 2000;
  assert.equal(guard.navigate()?.kind, 'slow');
  guard.input('keyDown');
  assert.equal(guard.navigate(), null, 'a key press lets the user continue');
});

test('someone clicking through pages is never stopped by the slow-loop limit', () => {
  const { clock, guard } = clocked();
  for (let i = 0; i < 40; i++) { guard.input(i % 2 ? 'mouseDown' : 'rawKeyDown'); assert.equal(guard.navigate(), null); clock.t += 1500; }
});

test('an occasional automatic reload stays allowed and old navigations age out', () => {
  const { clock, guard } = clocked();
  for (let i = 0; i < 30; i++) { assert.equal(guard.navigate(), null); clock.t += 10_000; }
});

test('the slow-loop limit can be turned off in Settings; the fast limit cannot', () => {
  let enabled = false;
  const { clock, guard } = clocked({ slowGuard: () => enabled });
  for (let i = 0; i < 20; i++) { assert.equal(guard.navigate(), null); clock.t += 2000; }
  enabled = true;
  assert.equal(guard.navigate()?.kind, 'slow');
  enabled = false;
  for (let i = 0; i < 7; i++) guard.navigate();
  assert.equal(guard.navigate()?.kind, 'fast');
});
