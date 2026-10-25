const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { rendererSource } = require('./helpers/renderer-source.cjs');

test('public recap is published on changes rather than a 30-second loop', () => {
  const source = rendererSource();
  assert.doesNotMatch(source, /setInterval\(\(\)=>publishStatsDashboard\(/);
  const start = source.indexOf('async function pushToFb(');
  const end = source.indexOf('function setSyncBadge(', start);
  const writer = source.slice(start, end);
  assert.match(writer, /clearTimeout\(syncDebounceTimer\)/);
  assert.match(writer, /sessionTools\.commitChanges\(/);
  assert.doesNotMatch(writer, /commitLibraryTransaction\(/);
  assert.match(writer, /sessionDocumentCount:sessionExpectedCount/);
  assert.match(writer, /publishStatsDashboard\(committed\.ts,committed\.games\)/);
});

test('cloud library deletion includes per-game documents before removing the root', () => {
  const source = rendererSource();
  const start = source.indexOf("document.getElementById('delete-cloud-data-btn')");
  const end = source.indexOf("document.getElementById('sign-out-btn')", start);
  const handler = source.slice(start, end);
  assert.match(handler, /legacyGamesRef\(user\),userGamesRef\(user\),userSessionsRef\(user\)/);
  assert.match(handler, /batch\.delete\(item\.ref\)/);
  assert.ok(handler.indexOf('await batch.commit()') < handler.indexOf("await deleteDoc(doc(fbDb,'users',user.uid,'profile','library'))"));
});
