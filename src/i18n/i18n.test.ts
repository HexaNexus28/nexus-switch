import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLocale } from './index.js';

test('English by default when nothing says French', () => {
  assert.equal(detectLocale({}, 'en-US', 'linux'), 'en');
  assert.equal(detectLocale({}, '', 'linux'), 'en');
  assert.equal(detectLocale({ LANG: 'de_DE.UTF-8' }, 'fr-FR', 'linux'), 'en');
});

test('French from the POSIX locale or the system (Windows) locale', () => {
  assert.equal(detectLocale({ LANG: 'fr_FR.UTF-8' }, 'en-US', 'linux'), 'fr');
  assert.equal(detectLocale({ LC_ALL: 'fr_CA.UTF-8', LANG: 'en_US.UTF-8' }, 'en-US', 'linux'), 'fr');
  assert.equal(detectLocale({}, 'fr-FR', 'linux'), 'fr');
});

test('NEXUS_LANG overrides everything', () => {
  assert.equal(detectLocale({ NEXUS_LANG: 'en', LANG: 'fr_FR.UTF-8' }, 'fr-FR', 'linux'), 'en');
  assert.equal(detectLocale({ NEXUS_LANG: 'fr', LANG: 'en_US.UTF-8' }, 'en-US', 'linux'), 'fr');
});

test('C / POSIX locales mean "unset": the next source decides', () => {
  assert.equal(detectLocale({ LANG: 'C.UTF-8' }, 'fr-FR', 'linux'), 'fr');
  assert.equal(detectLocale({ LC_ALL: 'POSIX' }, 'en-US', 'linux'), 'en');
});

test('Windows ignores LANG (Git Bash forces en_US) and trusts the system locale', () => {
  assert.equal(detectLocale({ LANG: 'en_US.UTF-8' }, 'fr-FR', 'win32'), 'fr');
  assert.equal(detectLocale({ LANG: 'fr_FR.UTF-8' }, 'en-US', 'win32'), 'en');
  assert.equal(detectLocale({ NEXUS_LANG: 'en' }, 'fr-FR', 'win32'), 'en');
});
