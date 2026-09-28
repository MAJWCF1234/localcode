const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localcode', {
  tree: () => ipcRenderer.invoke('workspace:tree'),
  read: (path) => ipcRenderer.invoke('workspace:read', path),
  write: (path, content) => ipcRenderer.invoke('workspace:write', path, content),
  createFolder: (path) => ipcRenderer.invoke('workspace:createFolder', path),
  delete: (path) => ipcRenderer.invoke('workspace:delete', path),
  rename: (from, to) => ipcRenderer.invoke('workspace:rename', from, to),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  runAgent: (prompt, settings) => ipcRenderer.invoke('agent:run', prompt, settings)
});
