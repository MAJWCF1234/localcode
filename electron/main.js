import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKSPACE = path.join(ROOT, 'workspace');
const SETTINGS = path.join(ROOT, 'localcode.settings.json');

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
    if (entry.isDirectory()) {
      out.push({ type: 'dir', name: entry.name, path: rel, children: await walk(full, base) });
    } else {
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
    if (entry.isDirectory()) await listFlat(full, base, acc);
    else acc.push(rel);
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

async function loadSettings() {
  const defaults = {
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'google/gemma-4-31b-qat',
    apiKey: 'lm-studio',
    temperature: 0.2
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

async function callModel(settings, messages) {
  const base = settings.baseUrl.replace(/\/$/, '');
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey || 'localcode'}`
    },
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

async function runAgent(prompt, settings) {
  await ensureWorkspace();
  const files = await listFlat();
  const messages = [
    {
      role: 'system',
      content: `You are LocalCode, a local coding agent. You may only operate inside ./workspace.\n\nAvailable actions:\n- {"action":"read","path":"relative/path"}\n- {"action":"write","path":"relative/path","content":"complete file contents"}\n- {"action":"delete","path":"relative/path"}\n- {"action":"rename","from":"old/path","to":"new/path"}\n- {"action":"list"}\n- {"action":"done","message":"summary"}\n\nReturn exactly ONE JSON object per turn and no other text. Use read before editing an existing file unless its contents were already provided to you. Never use absolute paths or .. segments. When writing, provide the COMPLETE replacement file content. Finish with done. Current workspace files:\n${files.join('\n') || '(empty)'}`
    },
    { role: 'user', content: prompt }
  ];

  const log = [];
  for (let step = 0; step < 16; step++) {
    const raw = await callModel(settings, messages);
    const action = extractJson(raw);
    if (!action?.action) {
      messages.push({ role: 'assistant', content: raw });
      messages.push({ role: 'user', content: 'Invalid response. Return exactly one valid JSON action object.' });
      continue;
    }

    let result;
    try {
      switch (action.action) {
        case 'read':
          result = await readText(action.path);
          log.push(`read ${action.path}`);
          break;
        case 'write':
          await writeText(action.path, String(action.content ?? ''));
          result = `wrote ${action.path}`;
          log.push(result);
          break;
        case 'delete':
          await deletePath(action.path);
          result = `deleted ${action.path}`;
          log.push(result);
          break;
        case 'rename':
          await renamePath(action.from, action.to);
          result = `renamed ${action.from} -> ${action.to}`;
          log.push(result);
          break;
        case 'list':
          result = (await listFlat()).join('\n') || '(empty)';
          log.push('listed workspace');
          break;
        case 'done':
          return { message: action.message || 'Done.', log, tree: await walk() };
        default:
          result = `Unknown action ${action.action}`;
      }
    } catch (err) {
      result = `ERROR: ${err.message}`;
      log.push(result);
    }

    messages.push({ role: 'assistant', content: JSON.stringify(action) });
    messages.push({ role: 'user', content: `RESULT:\n${result}` });
  }
  return { message: 'Stopped after 16 agent steps.', log, tree: await walk() };
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
  ipcMain.handle('workspace:tree', () => walk());
  ipcMain.handle('workspace:read', (_, rel) => readText(rel));
  ipcMain.handle('workspace:write', (_, rel, content) => writeText(rel, content));
  ipcMain.handle('workspace:createFolder', async (_, rel) => { await fs.mkdir(await safePath(rel, true), { recursive: true }); return true; });
  ipcMain.handle('workspace:delete', (_, rel) => deletePath(rel));
  ipcMain.handle('workspace:rename', (_, a, b) => renamePath(a, b));
  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:set', (_, s) => saveSettings(s));
  ipcMain.handle('agent:run', (_, prompt, settings) => runAgent(prompt, settings));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
