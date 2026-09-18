const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('launcher', {
  // Steam
  getSteamProfileLibrary: (profile, token) => ipcRenderer.invoke('steam:profileLibrary', { profile, token }),
  launchGame:      (appId) => ipcRenderer.invoke('steam:launchGame', appId),
  gameStatus:      (appId) => ipcRenderer.invoke('steam:gameStatus', appId),
  installStatus:   (appId) => ipcRenderer.invoke('steam:installStatus', appId),
  requestInstall:  (appId) => ipcRenderer.invoke('steam:requestInstall', appId),
  hideSteamWindow: () => ipcRenderer.invoke('steam:hideWindow'),
  trackSteamApps:  (appIds) => ipcRenderer.invoke('steam:trackApps', appIds),
  onSteamStatus:  (callback) => ipcRenderer.on('steam:status', (_, status) => callback(status)),
  getSteamCollection: (name) => ipcRenderer.invoke('steam:getCollection', name),
  getSteamStoreGames: (appIds) => ipcRenderer.invoke('steam:getStoreGames', appIds),
  onSteamCollection: (callback) => ipcRenderer.on('steam:collection', (_, collection) => callback(collection)),
  getRunningAppId: ()      => ipcRenderer.invoke('steam:getRunningAppId'),
  onSteamRunningApp: (callback) => ipcRenderer.on('steam:runningApp', (_, status) => callback(status)),

  // HowLongToBeat (keyless, on-demand metadata lookup)
  searchHltb: (query) => ipcRenderer.invoke('hltb:search', query),
  openHltbGame: (url) => ipcRenderer.invoke('hltb:openGame', url),

  // Backloggd public-profile importer (no password or private data)
  importBackloggdProfile: (url) => ipcRenderer.invoke('backloggd:importProfile', url),

  // Nintendo (experimental connector)
  setNintendoProfile: (uid) => ipcRenderer.invoke('nintendo:setProfile', uid),
  getSteamImportGames: () => ipcRenderer.invoke('steam:importGames'),
  openNintendoAuth:  () => ipcRenderer.invoke('nintendo:openAuth'),
  closeNintendoAuth: () => ipcRenderer.invoke('nintendo:closeAuth'),
  nintendoAuthStatus: () => ipcRenderer.invoke('nintendo:authStatus'),
  disconnectNintendo: () => ipcRenderer.invoke('nintendo:disconnect'),
  completeNintendoAuth: (callbackUrl) => ipcRenderer.invoke('nintendo:completeAuth', callbackUrl),
  fetchNintendoHistory: () => ipcRenderer.invoke('nintendo:fetchHistory'),
  onNintendoAuthComplete: (callback) => ipcRenderer.on('nintendo:authComplete', (_, status) => callback(status)),

  // Window controls
  minimize:    () => ipcRenderer.invoke('app:minimize'),
  hide:        () => ipcRenderer.invoke('app:hide'),
  maximize:    () => ipcRenderer.invoke('app:maximize'),
  isMaximized: () => ipcRenderer.invoke('app:isMaximized'),
  quit:        () => ipcRenderer.invoke('app:quit'),
  setSize:     (w, h) => ipcRenderer.invoke('app:setSize', w, h),
  exportBackup: (payload) => ipcRenderer.invoke('app:exportBackup', payload),
  importBackup: () => ipcRenderer.invoke('app:importBackup'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  downloadUpdate: () => ipcRenderer.invoke('app:downloadUpdate'),
  installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
  onUpdateStatus: (callback) => ipcRenderer.on('app:updateStatus', (_, status) => callback(status)),

  // Floating mini bar
  showMiniBar:  (state) => ipcRenderer.invoke('mini:show', state),
  updateMiniBar:(state) => ipcRenderer.invoke('mini:update', state),
  restoreMain:  () => ipcRenderer.invoke('mini:restore'),
  toggleMiniPin:() => ipcRenderer.invoke('mini:togglePin'),
  pauseMiniSession: () => ipcRenderer.send('mini:pause'),
  onMiniState:  (callback) => ipcRenderer.on('mini:state', (_, state) => callback(state)),
  onMiniTransition: (callback) => ipcRenderer.on('mini:transition', (_, phase) => callback(phase)),
  onMainTransition: (callback) => ipcRenderer.on('app:miniTransition', (_, phase) => callback(phase)),
  onMiniPause:  (callback) => ipcRenderer.on('mini:pause', callback),

  // Platform
  platform: process.platform,
  isElectron: true,
})
