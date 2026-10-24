// Small state machine for renderer sync orchestration. It has no Firebase or
// DOM dependency, so retries and write coalescing can be tested deterministically.
(function exposeSyncState(global) {
  function createSyncState() {
    let dirty = false;
    let retrying = false;
    let writing = false;
    let writeAgain = false;
    let writeWaiters = [];
    const releaseWriteWaiters = () => {
      const waiting = writeWaiters;
      writeWaiters = [];
      waiting.forEach(resolve => resolve());
    };
    return {
      reset() { dirty = false; retrying = false; writing = false; writeAgain = false; releaseWriteWaiters(); },
      markDirty() { dirty = true; },
      clearDirty() { dirty = false; },
      isDirty() { return dirty; },
      beginRetry() { if (retrying) return false; retrying = true; return true; },
      endRetry() { retrying = false; },
      isRetrying() { return retrying; },
      beginWrite() { if (writing) return false; writing = true; return true; },
      waitForWrite() { return writing ? new Promise(resolve => writeWaiters.push(resolve)) : Promise.resolve(); },
      requestWriteAgain() { writeAgain = true; },
      hasWriteAgain() { return writeAgain; },
      endWrite() { writing = false; const again = writeAgain; writeAgain = false; releaseWriteWaiters(); return again; },
      snapshot() { return { dirty, retrying, writing, writeAgain }; }
    };
  }
  global.createSyncState = createSyncState;
})(window);
