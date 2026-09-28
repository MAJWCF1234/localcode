import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Editor from '@monaco-editor/react';
import './styles.css';

function TreeNode({ node, onOpen }) {
  const [open, setOpen] = useState(true);
  if (node.type === 'dir') return (
    <div>
      <div className="tree-row folder" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} {node.name}</div>
      {open && <div className="indent">{node.children?.map(c => <TreeNode key={c.path} node={c} onOpen={onOpen}/>)}</div>}
    </div>
  );
  return <div className="tree-row file" onClick={() => onOpen(node.path)}>◇ {node.name}</div>;
}

function languageFor(path='') {
  const ext = path.split('.').pop()?.toLowerCase();
  return ({ js:'javascript', jsx:'javascript', ts:'typescript', tsx:'typescript', json:'json', html:'html', css:'css', py:'python', c:'c', cpp:'cpp', h:'cpp', hpp:'cpp', java:'java', rs:'rust', md:'markdown', sh:'shell', ps1:'powershell' })[ext] || 'plaintext';
}

function App() {
  const [tree, setTree] = useState([]);
  const [current, setCurrent] = useState('');
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refresh = async () => setTree(await window.localcode.tree());
  useEffect(() => { refresh(); window.localcode.getSettings().then(setSettings); }, []);

  const openFile = async (path) => {
    if (dirty && current) await window.localcode.write(current, content);
    setCurrent(path);
    setContent(await window.localcode.read(path));
    setDirty(false);
  };

  const save = async () => {
    if (!current) return;
    await window.localcode.write(current, content);
    setDirty(false);
    refresh();
  };

  const makeFile = async () => {
    const p = window.prompt('New file path inside workspace:');
    if (!p) return;
    await window.localcode.write(p, '');
    await refresh();
    openFile(p);
  };

  const makeFolder = async () => {
    const p = window.prompt('New folder path inside workspace:');
    if (!p) return;
    await window.localcode.createFolder(p);
    refresh();
  };

  const run = async () => {
    const text = prompt.trim();
    if (!text || !settings || busy) return;
    setPrompt(''); setBusy(true);
    setMessages(m => [...m, { who:'you', text }]);
    try {
      if (dirty) await save();
      const result = await window.localcode.runAgent(text, settings);
      setMessages(m => [...m, { who:'agent', text: result.message, log: result.log }]);
      setTree(result.tree || await window.localcode.tree());
      if (current) setContent(await window.localcode.read(current));
    } catch (e) {
      setMessages(m => [...m, { who:'error', text: e.message }]);
    } finally { setBusy(false); }
  };

  const title = useMemo(() => current ? `${current}${dirty ? ' •' : ''}` : 'No file open', [current, dirty]);

  return <div className="app">
    <header><div className="brand">LOCALCODE</div><div className="status">workspace/ only</div><button onClick={() => setSettingsOpen(!settingsOpen)}>Settings</button></header>
    {settingsOpen && settings && <section className="settings">
      <label>Base URL<input value={settings.baseUrl} onChange={e => setSettings({...settings, baseUrl:e.target.value})}/></label>
      <label>Model<input value={settings.model} onChange={e => setSettings({...settings, model:e.target.value})}/></label>
      <label>API key<input value={settings.apiKey} onChange={e => setSettings({...settings, apiKey:e.target.value})}/></label>
      <button onClick={async()=>{await window.localcode.setSettings(settings); setSettingsOpen(false)}}>Save settings</button>
    </section>}
    <main>
      <aside className="files">
        <div className="pane-title"><span>WORKSPACE</span><span><button onClick={makeFile}>+File</button><button onClick={makeFolder}>+Dir</button><button onClick={refresh}>↻</button></span></div>
        <div className="tree">{tree.map(n => <TreeNode key={n.path || n.name} node={n} onOpen={openFile}/>)}</div>
      </aside>
      <section className="editor-pane">
        <div className="tab"><span>{title}</span><button disabled={!dirty} onClick={save}>Save</button></div>
        <Editor height="100%" theme="vs-dark" language={languageFor(current)} value={content} onChange={v=>{setContent(v ?? ''); setDirty(true)}} options={{fontSize:14, minimap:{enabled:false}, automaticLayout:true, wordWrap:'off'}}/>
      </section>
      <aside className="agent">
        <div className="pane-title">LOCAL AGENT</div>
        <div className="messages">
          {messages.length===0 && <div className="empty">Tell the model what to build, fix, or change. It can inspect and modify files only inside <b>workspace/</b>.</div>}
          {messages.map((m,i)=><div className={`msg ${m.who}`} key={i}><b>{m.who}</b><div>{m.text}</div>{m.log?.length>0&&<pre>{m.log.join('\n')}</pre>}</div>)}
        </div>
        <div className="composer"><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&e.ctrlKey) run()}} placeholder="Build a Python app...\nFix the compile errors...\nRefactor the renderer..."/><button disabled={busy} onClick={run}>{busy?'Working…':'Run agent'}</button></div>
      </aside>
    </main>
  </div>
}

createRoot(document.getElementById('root')).render(<App/>);
