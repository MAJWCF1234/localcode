import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKSPACE = path.join(ROOT, 'workspace');
const SETTINGS = path.join(ROOT, 'localcode.settings.json');
const SESSIONS = path.join(ROOT, 'localcode.sessions.json');
const HISTORY = path.join(ROOT, '.localcode-history');

let workspaceWatcher = null;
let workspaceWatchTimer = null;
const activeRuns = new Map();
const pendingApprovals = new Map();

function lexicalSafePath(rel = '') {
  if (path.isAbsolute(rel) || rel.split(/[\\/]+/).includes('..')) {
    throw new Error('Absolute paths and .. are not allowed');
  }
  const target = path.resolve(WORKSPACE, rel);
  const prefix = WORKSPACE.endsWith(path.sep) ? WORKSPACE : WORKSPACE + path.sep;
  if (target !== WORKSPACE && !target.startsWith(prefix)) throw new Error('Path escapes ./workspace');
  return target;
}

async function safePath(rel = '', allowMissingLeaf = false) {
  const target = lexicalSafePath(rel);
  const relative = path.relative(WORKSPACE, target);
  const parts = relative ? relative.split(path.sep) : [];
  let cursor = WORKSPACE;
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]);
    try {
      const st = await fs.lstat(cursor);
      if (st.isSymbolicLink()) throw new Error('Symlinks are not allowed inside workspace paths');
    } catch (err) {
      if (err.code === 'ENOENT' && allowMissingLeaf) break;
      throw err;
    }
  }
  return target;
}

async function ensureWorkspace() {
  await fs.mkdir(WORKSPACE, { recursive: true });
}

async function walk(dir = WORKSPACE, base = WORKSPACE) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replaceAll('\\', '/');
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      out.push({ type: 'dir', name: entry.name, path: rel, children: await walk(full, base) });
    } else if (entry.isFile()) {
      out.push({ type: 'file', name: entry.name, path: rel });
    }
  }
  return out;
}

async function listFlat(dir = WORKSPACE, base = WORKSPACE, acc = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replaceAll('\\', '/');
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await listFlat(full, base, acc);
    else if (entry.isFile()) acc.push(rel);
  }
  return acc;
}

async function readText(rel) {
  const p = await safePath(rel);
  const stat = await fs.stat(p);
  if (stat.size > 2_000_000) throw new Error('File too large for editor (2 MB limit)');
  return fs.readFile(p, 'utf8');
}

async function writeText(rel, content) {
  const p = await safePath(rel, true);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, 'utf8');
  return true;
}

async function deletePath(rel) {
  const p = await safePath(rel);
  if (p === WORKSPACE) throw new Error('Cannot delete workspace root');
  await fs.rm(p, { recursive: true, force: true });
  return true;
}

async function renamePath(from, to) {
  const a = await safePath(from);
  const b = await safePath(to, true);
  await fs.mkdir(path.dirname(b), { recursive: true });
  await fs.rename(a, b);
  return true;
}

async function searchWorkspace(query, limit = 30) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  const files = await listFlat();
  const hits = [];
  for (const rel of files) {
    if (hits.length >= limit) break;
    try {
      const p = await safePath(rel);
      const stat = await fs.stat(p);
      if (stat.size > 512_000) continue;
      const text = await fs.readFile(p, 'utf8');
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length && hits.length < limit; i++) {
        if (lines[i].toLowerCase().includes(needle)) {
          hits.push({ path: rel, line: i + 1, text: lines[i].slice(0, 300) });
        }
      }
    } catch {
      // Ignore binary/unreadable files during text search.
    }
  }
  return hits;
}

async function loadSettings() {
  const defaults = {
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'google/gemma-4-31b-qat',
    apiKey: 'lm-studio',
    temperature: 0.2,
    maxAgentSteps: 24
  };
  try {
    return { ...defaults, ...JSON.parse(await fs.readFile(SETTINGS, 'utf8')) };
  } catch {
    return defaults;
  }
}

async function saveSettings(settings) {
  await fs.writeFile(SETTINGS, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return settings;
}

function apiHeaders(settings) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${settings.apiKey || 'localcode'}`
  };
}

async function listModels(settings) {
  const base = settings.baseUrl.replace(/\/$/, '');
  const response = await fetch(`${base}/models`, { headers: apiHeaders(settings) });
  if (!response.ok) throw new Error(`Model API ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return (data.data || []).map(model => model.id).filter(Boolean).sort();
}

async function callModel(settings, messages, signal) {
  const base = settings.baseUrl.replace(/\/$/, '');
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: apiHeaders(settings),
    signal,
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: settings.temperature ?? 0.2,
      stream: false
    })
  });
  if (!response.ok) throw new Error(`Model API ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}

function newSession(title = 'New chat') {
  const now = new Date().toISOString();
  return { id: randomUUID(), title, createdAt: now, updatedAt: now, messages: [] };
}

async function loadSessionStore() {
  try {
    const store = JSON.parse(await fs.readFile(SESSIONS, 'utf8'));
    if (!Array.isArray(store.sessions)) throw new Error('Invalid sessions file');
    if (!store.sessions.length) {
      const session = newSession();
      return { activeId: session.id, sessions: [session] };
    }
    if (!store.sessions.some(s => s.id === store.activeId)) store.activeId = store.sessions[0].id;
    return store;
  } catch {
    const session = newSession();
    const store = { activeId: session.id, sessions: [session] };
    await saveSessionStore(store);
    return store;
  }
}

async function saveSessionStore(store) {
  await fs.writeFile(SESSIONS, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

function publicChatState(store) {
  const active = store.sessions.find(s => s.id === store.activeId) || store.sessions[0];
  return {
    activeId: active?.id || null,
    sessions: store.sessions
      .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    messages: active?.messages || []
  };
}

async function getChatState() {
  return publicChatState(await loadSessionStore());
}

async function createChat() {
  const store = await loadSessionStore();
  const session = newSession();
  store.sessions.push(session);
  store.activeId = session.id;
  await saveSessionStore(store);
  return publicChatState(store);
}

async function selectChat(id) {
  const store = await loadSessionStore();
  if (!store.sessions.some(s => s.id === id)) throw new Error('Chat session not found');
  store.activeId = id;
  await saveSessionStore(store);
  return publicChatState(store);
}

async function deleteChat(id) {
  const store = await loadSessionStore();
  store.sessions = store.sessions.filter(s => s.id !== id);
  if (!store.sessions.length) store.sessions.push(newSession());
  if (!store.sessions.some(s => s.id === store.activeId)) store.activeId = store.sessions[0].id;
  await saveSessionStore(store);
  return publicChatState(store);
}

function emitAgent(sender, runId, event) {
  if (!sender?.isDestroyed()) sender.send('agent:event', { runId, ...event });
}



async function ensureHistory() {
  await fs.mkdir(HISTORY, { recursive: true });
}

function historyRunDir(runId) {
  return path.join(HISTORY, runId);
}

async function captureBefore(runId, rel) {
  const state = activeRuns.get(runId);
  if (!state) return;
  if (!state.snapshots) state.snapshots = new Map();

  const normalized = path.relative(WORKSPACE, lexicalSafePath(rel)).replaceAll('\\', '/');
  if (!normalized || state.snapshots.has(normalized)) return;

  const target = await safePath(normalized, true);
  let existed = false;
  let kind = 'missing';

  try {
    const st = await fs.lstat(target);
    if (st.isSymbolicLink()) throw new Error('Symlinks cannot be snapshotted');
    existed = true;
    kind = st.isDirectory() ? 'dir' : 'file';
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const snapshot = { path: normalized, existed, kind };
  state.snapshots.set(normalized, snapshot);

  if (existed) {
    const backup = path.join(historyRunDir(runId), 'before', ...normalized.split('/'));
    await fs.mkdir(path.dirname(backup), { recursive: true });
    if (kind === 'dir') await fs.cp(target, backup, { recursive: true, force: true });
    else await fs.copyFile(target, backup);
  }
}

async function finalizeHistory(runId) {
  const state = activeRuns.get(runId);
  if (!state?.snapshots?.size) return [];

  await ensureHistory();
  const changes = Array.from(state.snapshots.values());
  const dir = historyRunDir(runId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
    runId,
    createdAt: new Date().toISOString(),
    changes,
    terminalUsed: Boolean(state.terminalUsed)
  }, null, 2) + '\n', 'utf8');

  return changes;
}

async function readHistoryManifest(runId) {
  const manifestPath = path.join(historyRunDir(runId), 'manifest.json');
  return JSON.parse(await fs.readFile(manifestPath, 'utf8'));
}

async function undoHistoryRun(runId) {
  const manifest = await readHistoryManifest(runId);
  const entries = Array.isArray(manifest.changes) ? manifest.changes : [];

  const byDepthDesc = [...entries].sort((a, b) => b.path.split('/').length - a.path.split('/').length);
  for (const entry of byDepthDesc) {
    const target = await safePath(entry.path, true);
    await fs.rm(target, { recursive: true, force: true });
  }

  const byDepthAsc = [...entries].sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  for (const entry of byDepthAsc) {
    if (!entry.existed) continue;
    const target = await safePath(entry.path, true);
    const backup = path.join(historyRunDir(runId), 'before', ...entry.path.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (entry.kind === 'dir') await fs.cp(backup, target, { recursive: true, force: true });
    else await fs.copyFile(backup, target);
  }

  return {
    restored: entries.map(entry => entry.path),
    terminalUsed: Boolean(manifest.terminalUsed),
    tree: await walk()
  };
}

function requestCommandApproval(sender, runId, command) {
  return new Promise((resolve) => {
    const approvalId = randomUUID();
    pendingApprovals.set(approvalId, { resolve, runId });
    emitAgent(sender, runId, {
      type: 'approval',
      approvalId,
      command,
      text: 'Command requires approval'
    });
  });
}

function resolveApproval(approvalId, allowed) {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return false;
  pendingApprovals.delete(approvalId);
  pending.resolve(Boolean(allowed));
  return true;
}

function cancelApprovalsForRun(runId) {
  for (const [approvalId, pending] of pendingApprovals.entries()) {
    if (pending.runId === runId) {
      pendingApprovals.delete(approvalId);
      pending.resolve(false);
    }
  }
}

async function runApprovedCommand(command, runId, sender, controller) {
  const clean = String(command || '').trim();
  if (!clean) throw new Error('Empty command');

  emitAgent(sender, runId, {
    type: 'approval',
    text: 'Waiting for command approval…',
    command: clean
  });

  const allowed = await requestCommandApproval(sender, runId, clean);
  if (!allowed) return { approved: false, output: 'COMMAND DENIED BY USER' };
  if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

  const runStateForTerminal = activeRuns.get(runId);
  if (runStateForTerminal) runStateForTerminal.terminalUsed = true;

  emitAgent(sender, runId, {
    type: 'terminal',
    text: `Running: ${clean}`,
    command: clean
  });

  return await new Promise((resolve, reject) => {
    const child = spawn(clean, {
      cwd: WORKSPACE,
      shell: true,
      windowsHide: true,
      env: process.env
    });

    const runState = activeRuns.get(runId);
    if (runState) runState.child = child;

    let stdout = '';
    let stderr = '';
    let finished = false;
    const OUTPUT_LIMIT = 200_000;
    const TIMEOUT_MS = 120_000;

    const append = (kind, chunk) => {
      const text = chunk.toString();
      if (kind === 'stdout') stdout = (stdout + text).slice(-OUTPUT_LIMIT);
      else stderr = (stderr + text).slice(-OUTPUT_LIMIT);
      emitAgent(sender, runId, {
        type: 'terminal-output',
        stream: kind,
        text: text.slice(0, 2000)
      });
    };

    child.stdout?.on('data', chunk => append('stdout', chunk));
    child.stderr?.on('data', chunk => append('stderr', chunk));

    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      const state = activeRuns.get(runId);
      if (state?.child === child) state.child = null;
      fn(value);
    };

    const onAbort = () => {
      try { child.kill(); } catch {}
      finish(reject, new DOMException('Aborted', 'AbortError'));
    };

    controller.signal.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(resolve, {
        approved: true,
        timedOut: true,
        exitCode: null,
        output: `COMMAND TIMED OUT AFTER 120 SECONDS\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`
      });
    }, TIMEOUT_MS);

    child.on('error', err => finish(reject, err));
    child.on('close', code => {
      finish(resolve, {
        approved: true,
        timedOut: false,
        exitCode: code,
        output: `EXIT CODE: ${code}\n\nSTDOUT:\n${stdout || '(empty)'}\n\nSTDERR:\n${stderr || '(empty)'}`
      });
    });
  });
}

async function runAgent(prompt, settings, sessionId, runId, sender) {
  await ensureWorkspace();
  const controller = new AbortController();
  activeRuns.set(runId, { controller, child: null, snapshots: new Map(), terminalUsed: false });

  const store = await loadSessionStore();
  const session = store.sessions.find(s => s.id === sessionId) || store.sessions.find(s => s.id === store.activeId);
  if (!session) throw new Error('Chat session not found');

  const userMessage = { id: randomUUID(), role: 'user', content: prompt, createdAt: new Date().toISOString() };
  session.messages.push(userMessage);
  if (session.title === 'New chat') session.title = prompt.trim().replace(/\s+/g, ' ').slice(0, 52) || 'New chat';
  session.updatedAt = new Date().toISOString();
  store.activeId = session.id;
  await saveSessionStore(store);

  const files = await listFlat();
  const history = session.messages
    .slice(-14, -1)
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.content }));

  const messages = [
    {
      role: 'system',
      content: `You are LocalCode, a persistent local coding agent. You may only operate inside ./workspace.

Available actions:
- {"action":"list"}
- {"action":"read","path":"relative/path"}
- {"action":"search","query":"text"}
- {"action":"write","path":"relative/path","content":"complete file contents"}
- {"action":"mkdir","path":"relative/folder"}
- {"action":"delete","path":"relative/path"}
- {"action":"rename","from":"old/path","to":"new/path"}
- {"action":"run","command":"command to execute from workspace"}
- {"action":"done","message":"clear summary of what you did or what you found"}

Return exactly ONE JSON object per turn and no other text.
Use read before editing an existing file unless its current contents were already provided.
Use search when you know a symbol or phrase but not its location.
Never use absolute paths or .. segments.
When writing, provide COMPLETE replacement file contents.
Use run when you need to build, test, inspect compiler output, or execute project tooling. Every command requires explicit user approval before execution. Commands start in ./workspace but are real machine shell commands, so keep them focused and necessary. Report build/test results only from actual command output.
Finish with done.

Current workspace files:
${files.join('\n') || '(empty)'}`
    },
    ...history,
    { role: 'user', content: prompt }
  ];

  const log = [];
  const maxSteps = Math.max(4, Math.min(Number(settings.maxAgentSteps) || 24, 64));

  try {
    for (let step = 0; step < maxSteps; step++) {
      emitAgent(sender, runId, { type: 'thinking', step: step + 1, maxSteps, text: 'Model is planning the next action…' });
      const raw = await callModel(settings, messages, controller.signal);
      const action = extractJson(raw);

      if (!action?.action) {
        log.push('model returned invalid action JSON; retrying');
        emitAgent(sender, runId, { type: 'warning', text: 'Model returned invalid tool JSON. Retrying…' });
        messages.push({ role: 'assistant', content: raw });
        messages.push({ role: 'user', content: 'Invalid response. Return exactly one valid JSON action object.' });
        continue;
      }

      let result;
      try {
        switch (action.action) {
          case 'read':
            emitAgent(sender, runId, { type: 'tool', tool: 'read', text: `Reading ${action.path}`, path: action.path });
            result = await readText(action.path);
            log.push(`read ${action.path}`);
            break;
          case 'search': {
            emitAgent(sender, runId, { type: 'tool', tool: 'search', text: `Searching for "${action.query}"` });
            const hits = await searchWorkspace(action.query);
            result = hits.length ? hits.map(h => `${h.path}:${h.line}: ${h.text}`).join('\n') : '(no matches)';
            log.push(`searched "${action.query}" (${hits.length} hits)`);
            break;
          }
          case 'write':
            emitAgent(sender, runId, { type: 'tool', tool: 'write', text: `Writing ${action.path}`, path: action.path });
            await captureBefore(runId, action.path);
            await writeText(action.path, String(action.content ?? ''));
            result = `wrote ${action.path}`;
            log.push(result);
            break;
          case 'mkdir':
            emitAgent(sender, runId, { type: 'tool', tool: 'mkdir', text: `Creating ${action.path}`, path: action.path });
            await captureBefore(runId, action.path);
            await fs.mkdir(await safePath(action.path, true), { recursive: true });
            result = `created directory ${action.path}`;
            log.push(result);
            break;
          case 'delete':
            emitAgent(sender, runId, { type: 'tool', tool: 'delete', text: `Deleting ${action.path}`, path: action.path });
            await captureBefore(runId, action.path);
            await deletePath(action.path);
            result = `deleted ${action.path}`;
            log.push(result);
            break;
          case 'rename':
            emitAgent(sender, runId, { type: 'tool', tool: 'rename', text: `Renaming ${action.from} → ${action.to}` });
            await captureBefore(runId, action.from);
            await captureBefore(runId, action.to);
            await renamePath(action.from, action.to);
            result = `renamed ${action.from} -> ${action.to}`;
            log.push(result);
            break;
          case 'list':
            emitAgent(sender, runId, { type: 'tool', tool: 'list', text: 'Scanning workspace files' });
            result = (await listFlat()).join('\n') || '(empty)';
            log.push('listed workspace');
            break;
          case 'run': {
            const commandResult = await runApprovedCommand(action.command, runId, sender, controller);
            result = commandResult.output;
            if (commandResult.approved) {
              log.push(`ran command: ${action.command} (exit ${commandResult.exitCode ?? 'timeout'})`);
            } else {
              log.push(`command denied: ${action.command}`);
            }
            break;
          }
          case 'done': {
            const changes = await finalizeHistory(runId);
            const terminalUsed = Boolean(activeRuns.get(runId)?.terminalUsed);
            const assistantMessage = {
              id: randomUUID(),
              role: 'assistant',
              content: action.message || 'Done.',
              log,
              runId,
              changes,
              terminalUsed,
              createdAt: new Date().toISOString()
            };
            session.messages.push(assistantMessage);
            session.updatedAt = new Date().toISOString();
            await saveSessionStore(store);
            emitAgent(sender, runId, { type: 'done', text: assistantMessage.content });
            return { message: assistantMessage.content, log, changes, terminalUsed, runId, tree: await walk(), chat: publicChatState(store) };
          }
          default:
            result = `Unknown action ${action.action}`;
            log.push(result);
        }
      } catch (err) {
        result = `ERROR: ${err.message}`;
        log.push(result);
        emitAgent(sender, runId, { type: 'warning', text: result });
      }

      messages.push({ role: 'assistant', content: JSON.stringify(action) });
      messages.push({ role: 'user', content: `RESULT:\n${result}` });
    }

    const message = `Stopped after ${maxSteps} agent steps before receiving a done action.`;
    const changes = await finalizeHistory(runId);
    const terminalUsed = Boolean(activeRuns.get(runId)?.terminalUsed);
    session.messages.push({ id: randomUUID(), role: 'assistant', content: message, log, runId, changes, terminalUsed, createdAt: new Date().toISOString() });
    session.updatedAt = new Date().toISOString();
    await saveSessionStore(store);
    return { message, log, tree: await walk(), chat: publicChatState(store) };
  } catch (err) {
    if (err?.name === 'AbortError') {
      const message = 'Run cancelled.';
      const changes = await finalizeHistory(runId);
      const terminalUsed = Boolean(activeRuns.get(runId)?.terminalUsed);
      session.messages.push({ id: randomUUID(), role: 'assistant', content: message, log, runId, changes, terminalUsed, createdAt: new Date().toISOString() });
      session.updatedAt = new Date().toISOString();
      await saveSessionStore(store);
      emitAgent(sender, runId, { type: 'cancelled', text: message });
      return { message, log, tree: await walk(), chat: publicChatState(store), cancelled: true };
    }
    throw err;
  } finally {
    cancelApprovalsForRun(runId);
    activeRuns.delete(runId);
  }
}

function startWorkspaceWatcher() {
  if (workspaceWatcher) return;
  try {
    workspaceWatcher = fsSync.watch(WORKSPACE, { recursive: true }, () => {
      clearTimeout(workspaceWatchTimer);
      workspaceWatchTimer = setTimeout(() => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('workspace:changed');
        }
      }, 120);
    });
  } catch (err) {
    console.warn('Workspace watcher unavailable:', err.message);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#101114',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else if (fsSync.existsSync(path.join(ROOT, 'dist', 'index.html'))) win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  else win.loadURL('http://127.0.0.1:5173');
}

app.whenReady().then(async () => {
  await ensureWorkspace();
  await loadSessionStore();
  startWorkspaceWatcher();

  ipcMain.handle('workspace:tree', () => walk());
  ipcMain.handle('workspace:read', (_, rel) => readText(rel));
  ipcMain.handle('workspace:write', (_, rel, content) => writeText(rel, content));
  ipcMain.handle('workspace:createFolder', async (_, rel) => { await fs.mkdir(await safePath(rel, true), { recursive: true }); return true; });
  ipcMain.handle('workspace:delete', (_, rel) => deletePath(rel));
  ipcMain.handle('workspace:rename', (_, a, b) => renamePath(a, b));

  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:set', (_, s) => saveSettings(s));
  ipcMain.handle('models:list', (_, s) => listModels(s));

  ipcMain.handle('chat:state', () => getChatState());
  ipcMain.handle('chat:new', () => createChat());
  ipcMain.handle('chat:select', (_, id) => selectChat(id));
  ipcMain.handle('chat:delete', (_, id) => deleteChat(id));
  ipcMain.handle('history:undo', (_, runId) => undoHistoryRun(runId));

  ipcMain.handle('agent:run', (event, prompt, settings, sessionId, runId) => runAgent(prompt, settings, sessionId, runId, event.sender));
  ipcMain.handle('agent:cancel', (_, runId) => {
    const state = activeRuns.get(runId);
    if (!state) return false;
    cancelApprovalsForRun(runId);
    try { state.child?.kill(); } catch {}
    state.controller.abort();
    return true;
  });
  ipcMain.handle('agent:approval', (_, approvalId, allowed) => resolveApproval(approvalId, allowed));

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => {
  clearTimeout(workspaceWatchTimer);
  workspaceWatcher?.close();
  workspaceWatcher = null;
  for (const [runId, state] of activeRuns.entries()) {
    cancelApprovalsForRun(runId);
    try { state.child?.kill(); } catch {}
    state.controller.abort();
  }
  activeRuns.clear();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
