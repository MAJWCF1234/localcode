# LocalCode

LocalCode is a desktop, local-first coding agent and editor for OpenAI-compatible local model servers such as LM Studio.

## Current agent harness

LocalCode now has a persistent multi-turn agent loop rather than a one-shot prompt wrapper.

- Multiple local chat sessions
- Chat history persists in `localcode.sessions.json`
- Follow-up prompts include recent chat context
- Live agent activity is shown while a run is executing
- Runs can be cancelled
- Maximum agent steps are configurable
- Workspace text search is available to the agent
- Agent state and settings remain local and are ignored by Git

The coding agent can inspect and modify files inside `./workspace` using its filesystem tools. It can list, read, search, create folders, write files, rename paths, and remove paths.

## Workspace boundary

`./workspace` is the only app-managed project root.

- Files dropped into it are detected while LocalCode is open
- Absolute paths and parent traversal are rejected
- Symlink path components are rejected
- Monaco is used for manual file editing
- Ctrl+S / Cmd+S saves the current editor file

## Chat

The right-hand panel now supports:

- persistent conversations
- New Chat
- chat switching
- deleting old chats
- live tool/action status
- expandable action history on completed responses
- Stop during a running agent task

## LM Studio

Default endpoint:

```text
http://127.0.0.1:1234/v1
```

Open Settings and use **Detect models** to query the local server and populate model IDs.

## Run on Windows

```text
StartLocalCode.cmd
```

The launcher installs dependencies if required, builds the frontend, verifies the output, and starts Electron.

To update your local source:

```text
SyncFromGitHub.cmd
```

The sync helper preserves ignored local data including `workspace/`, local settings, and chat sessions.

## Still being built

The main missing harness layer is terminal/build/test execution. It is intentionally not exposed as unrestricted shell access yet because arbitrary commands can escape a filesystem-only workspace sandbox.

The planned terminal layer will include explicit command approval, visible command text, cancellation/timeouts, and separate permissions from ordinary workspace edits.

Other planned improvements include diff/review UI, longer-context compaction, and token streaming.
