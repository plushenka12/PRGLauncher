const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('owner cache becomes visible before native account and cloud requests', () => {
  const source = fs.readFileSync('src/renderer/index.html', 'utf8');
  const authStart = source.indexOf('onAuthStateChanged(fbAuth,async user=>{');
  const authEnd = source.indexOf('function userLibraryRef()', authStart);
  assert.ok(authStart >= 0 && authEnd > authStart);
  const handler = source.slice(authStart, authEnd);
  const ownerCheck = handler.indexOf('user.uid!==PRG_OWNER_UID');
  const showCache = handler.indexOf('restoreCachedLibrary();');
  const hideOverlay = handler.indexOf('hideLogin();');
  const nativeRequest = handler.indexOf('setNintendoProfile?.(');
  const cloudRequest = handler.indexOf('startUserSync(user)');
  assert.ok(ownerCheck >= 0 && showCache > ownerCheck, 'only verified owner may display cached data');
  assert.ok(hideOverlay > showCache && hideOverlay < nativeRequest, 'native account request must not block the library');
  assert.ok(showCache < cloudRequest, 'cloud request must not block the library');
});

test('pending local edits survive restart and block an automatic cloud overwrite', () => {
  const source = fs.readFileSync('src/renderer/index.html', 'utf8');
  assert.match(source, /const syncPendingKey=\(\)=>profileStorageKey\('gv-sync-pending-v1'\)/);
  assert.match(source, /function queueLibrarySync\(\)\{[\s\S]*?markPendingLibrarySync\(\)/);
  assert.match(source, /reconcileLibraries\(loadSyncBase\(\),localGames,remoteGames\)/);
  assert.match(source, /if\(merged\.conflict\)\{games=localGames;syncState\.markDirty\(\);openSyncConflict\(remoteGames,remoteTs\)/);
  assert.match(source, /!syncActive\|\|syncConflictRemote\)return;pushToFb/);
  assert.match(source, /if\(!fbDb\|\|!currentUser\|\|\(syncConflictRemote&&!forceLocalAgainst\)\)return false/);
  assert.match(source, /libraryEditRevision===editRevision&&baseStored\)\{syncState\.clearDirty\(\);clearPendingLibrarySync\(\)/);
});
