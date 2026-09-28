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
  listModels: (settings) => ipcRenderer.invoke('models:list', settings),

  getChatState: () => ipcRenderer.invoke('chat:state'),
  newChat: () => ipcRenderer.invoke('chat:new'),
  selectChat: (id) => ipcRenderer.invoke('chat:select', id),
  deleteChat: (id) => ipcRenderer.invoke('chat:delete', id),

  runAgent: (prompt, settings, sessionId, runId) => ipcRenderer.invoke('agent:run', prompt, settings, sessionId, runId),
  cancelAgent: (runId) => ipcRenderer.invoke('agent:cancel', runId),
  resolveAgentApproval: (approvalId, allowed) => ipcRenderer.invoke('agent:approval', approvalId, allowed),

  onWorkspaceChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('workspace:changed', handler);
    return () => ipcRenderer.removeListener('workspace:changed', handler);
  },
  onAgentEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('agent:event', handler);
    return () => ipcRenderer.removeListener('agent:event', handler);
  }
});
