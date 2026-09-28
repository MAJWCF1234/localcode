import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  return ({ js:'javascript', jsx:'javascript', ts:'typescript', tsx:'typescript', json:'json', html:'html', css:'css', py:'python', c:'c', cpp:'cpp', h:'cpp', hpp:'cpp', java:'java', rs:'rust', md:'markdown', sh:'shell', ps1:'powershell', bat:'bat' })[ext] || 'plaintext';
}

function makeRunId() {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function App() {
  const [tree, setTree] = useState([]);
  const [current, setCurrent] = useState('');
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);

  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeRunId, setActiveRunId] = useState('');
  const [liveEvents, setLiveEvents] = useState([]);

  const [chatState, setChatState] = useState({ activeId:null, sessions:[], messages:[] });

  const [settings, setSettings] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelOptions, setModelOptions] = useState([]);
  const [modelStatus, setModelStatus] = useState('');

  const messagesRef = useRef(null);

  const refresh = async () => setTree(await window.localcode.tree());

  useEffect(() => {
    refresh();
    window.localcode.getSettings().then(setSettings);
    window.localcode.getChatState().then(setChatState);

    const unsubscribeWorkspace = window.localcode.onWorkspaceChanged?.(() => refresh());
    const unsubscribeAgent = window.localcode.onAgentEvent?.((event) => {
      setLiveEvents(events => {
        const next = [...events, event];
        return next.slice(-12);
      });
    });

    return () => {
      unsubscribeWorkspace?.();
      unsubscribeAgent?.();
    };
  }, []);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [chatState.messages, liveEvents]);

  useEffect(() => {
    const onKeyDown = async (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (current && dirty) {
          await window.localcode.write(current, content);
          setDirty(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [current, content, dirty]);

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

  const detectModels = async () => {
    if (!settings) return;
    setModelStatus('Checking local server…');
    try {
      const models = await window.localcode.listModels(settings);
      setModelOptions(models);
      setModelStatus(models.length ? `Connected · ${models.length} model${models.length === 1 ? '' : 's'} found` : 'Connected · no models reported');
      if (!settings.model && models[0]) setSettings({ ...settings, model: models[0] });
    } catch (error) {
      setModelOptions([]);
      setModelStatus(`Connection failed: ${error.message}`);
    }
  };

  const startNewChat = async () => {
    if (busy) return;
    setLiveEvents([]);
    setChatState(await window.localcode.newChat());
  };

  const switchChat = async (id) => {
    if (busy || !id) return;
    setLiveEvents([]);
    setChatState(await window.localcode.selectChat(id));
  };

  const removeChat = async () => {
    if (busy || !chatState.activeId) return;
    if (!window.confirm('Delete this LocalCode chat?')) return;
    setLiveEvents([]);
    setChatState(await window.localcode.deleteChat(chatState.activeId));
  };

  const run = async () => {
    const text = prompt.trim();
    if (!text || !settings || busy || !chatState.activeId) return;

    if (dirty) await save();

    const runId = makeRunId();
    setPrompt('');
    setBusy(true);
    setActiveRunId(runId);
    setLiveEvents([{ runId, type:'status', text:'Starting agent run…' }]);

    setChatState(state => ({
      ...state,
      messages: [...state.messages, {
        id: `optimistic-${runId}`,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString()
      }]
    }));

    try {
      const result = await window.localcode.runAgent(text, settings, chatState.activeId, runId);
      if (result.chat) setChatState(result.chat);
      setTree(result.tree || await window.localcode.tree());

      if (current) {
        try {
          setContent(await window.localcode.read(current));
          setDirty(false);
        } catch {
          setCurrent('');
          setContent('');
          setDirty(false);
        }
      }
    } catch (error) {
      const fresh = await window.localcode.getChatState();
      setChatState({
        ...fresh,
        messages: [...fresh.messages, {
          id: `error-${runId}`,
          role: 'error',
          content: error.message,
          createdAt: new Date().toISOString()
        }]
      });
    } finally {
      setBusy(false);
      setActiveRunId('');
    }
  };

  const cancelRun = async () => {
    if (!activeRunId) return;
    await window.localcode.cancelAgent(activeRunId);
  };

  const title = useMemo(() => current ? `${current}${dirty ? ' •' : ''}` : 'No file open', [current, dirty]);

  return <div className="app">
    <header>
      <div className="brand">LOCALCODE</div>
      <div className="status">workspace/ only · persistent local agent</div>
      <button onClick={() => setSettingsOpen(!settingsOpen)}>Settings</button>
    </header>

    {settingsOpen && settings && <section className="settings">
      <label>Base URL<input value={settings.baseUrl} onChange={e => setSettings({...settings, baseUrl:e.target.value})}/></label>
      <label>Model
        <input list="localcode-models" value={settings.model} onChange={e => setSettings({...settings, model:e.target.value})}/>
        <datalist id="localcode-models">{modelOptions.map(model => <option key={model} value={model}/>)}</datalist>
      </label>
      <label>API key<input value={settings.apiKey} onChange={e => setSettings({...settings, apiKey:e.target.value})}/></label>
      <label>Max agent steps<input type="number" min="4" max="64" value={settings.maxAgentSteps ?? 24} onChange={e => setSettings({...settings, maxAgentSteps:Number(e.target.value)})}/></label>
      <div className="settings-actions">
        <button onClick={detectModels}>Detect models</button>
        <button onClick={async()=>{await window.localcode.setSettings(settings); setSettingsOpen(false)}}>Save settings</button>
      </div>
      {modelStatus && <div className={`connection-status ${modelStatus.startsWith('Connection failed') ? 'bad' : ''}`}>{modelStatus}</div>}
    </section>}

    <main>
      <aside className="files">
        <div className="pane-title">
          <span>WORKSPACE</span>
          <span><button onClick={makeFile}>+File</button><button onClick={makeFolder}>+Dir</button><button onClick={refresh}>↻</button></span>
        </div>
        <div className="tree">{tree.map(n => <TreeNode key={n.path || n.name} node={n} onOpen={openFile}/>)}</div>
      </aside>

      <section className="editor-pane">
        <div className="tab"><span>{title}</span><button disabled={!dirty} onClick={save}>Save</button></div>
        <Editor
          height="100%"
          theme="vs-dark"
          language={languageFor(current)}
          value={content}
          onChange={v=>{setContent(v ?? ''); setDirty(true)}}
          options={{fontSize:14, minimap:{enabled:false}, automaticLayout:true, wordWrap:'off'}}
        />
      </section>

      <aside className="agent">
        <div className="chat-toolbar">
          <select value={chatState.activeId || ''} disabled={busy} onChange={e => switchChat(e.target.value)}>
            {chatState.sessions.map(session => <option key={session.id} value={session.id}>{session.title}</option>)}
          </select>
          <button disabled={busy} onClick={startNewChat}>New</button>
          <button disabled={busy || chatState.sessions.length <= 1} onClick={removeChat}>Delete</button>
        </div>

        <div className="messages" ref={messagesRef}>
          {chatState.messages.length===0 && <div className="empty">
            This chat keeps context across prompts. Tell the agent what to build, fix, inspect, or continue working on.
          </div>}

          {chatState.messages.map((m,i)=>
            <div className={`msg ${m.role}`} key={m.id || i}>
              <b>{m.role === 'user' ? 'you' : m.role}</b>
              <div className="msg-text">{m.content}</div>
              {m.log?.length>0 && <details><summary>{m.log.length} tool actions</summary><pre>{m.log.join('\n')}</pre></details>}
            </div>
          )}

          {busy && <div className="live-run">
            <div className="live-title"><span className="pulse">●</span> AGENT RUNNING</div>
            {liveEvents.map((event,i)=><div className={`live-event ${event.type}`} key={i}>{event.text}</div>)}
          </div>}
        </div>

        <div className="composer">
          <textarea
            value={prompt}
            disabled={busy}
            onChange={e=>setPrompt(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter'&&e.ctrlKey) run()}}
            placeholder="Continue fixing this project…\nFind where renderer state is created…\nCreate the missing subsystem…"
          />
          <div className="composer-actions">
            <span>Ctrl+Enter to run</span>
            {busy
              ? <button className="stop" onClick={cancelRun}>Stop</button>
              : <button onClick={run}>Run agent</button>}
          </div>
        </div>
      </aside>
    </main>
  </div>
}

createRoot(document.getElementById('root')).render(<App/>);
