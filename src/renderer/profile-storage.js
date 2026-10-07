// Profile-scoped storage adapter. It deliberately knows nothing about the UI
// or Firebase so the renderer can migrate persistence incrementally.
(function exposeProfileStorage(global) {
  function createProfileStorage(storage, getUser) {
    const key = name => {
      const user = typeof getUser === 'function' ? getUser() : null;
      return user?.uid ? `${name}:${user.uid}` : name;
    };
    const read = (name, fallback = null) => {
      try {
        const raw = storage.getItem(key(name));
        return raw == null ? fallback : raw;
      } catch {
        return fallback;
      }
    };
    const readJSON = (name, fallback) => {
      try {
        const raw = read(name, null);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    };
    const write = (name, value) => storage.setItem(key(name), String(value));
    const writeJSON = (name, value) => write(name, JSON.stringify(value));
    const remove = name => storage.removeItem(key(name));
    return { key, read, readJSON, write, writeJSON, remove };
  }

  global.createProfileStorage = createProfileStorage;
})(window);
