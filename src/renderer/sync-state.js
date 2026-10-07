// Small state machine for renderer sync orchestration. It has no Firebase or
// DOM dependency, so retries and write coalescing can be tested deterministically.
(function exposeSyncState(global) {
  function createSyncState() {
    let dirty = false;
    let retrying = false;
    let writing = false;
    let writeAgain = false;
    return {
      reset() { dirty = false; retrying = false; writing = false; writeAgain = false; },
      markDirty() { dirty = true; },
      clearDirty() { dirty = false; },
      isDirty() { return dirty; },
      beginRetry() { if (retrying) return false; retrying = true; return true; },
      endRetry() { retrying = false; },
      isRetrying() { return retrying; },
      beginWrite() { if (writing) return false; writing = true; return true; },
      requestWriteAgain() { writeAgain = true; },
      hasWriteAgain() { return writeAgain; },
      endWrite() { writing = false; const again = writeAgain; writeAgain = false; return again; },
      snapshot() { return { dirty, retrying, writing, writeAgain }; }
    };
  }
  global.createSyncState = createSyncState;
})(window);
