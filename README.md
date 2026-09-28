# LocalCode

LocalCode is a desktop, local-first coding agent and editor for OpenAI-compatible local model servers such as LM Studio.

## Agent harness

LocalCode has a persistent multi-turn coding-agent harness.

### Chat

- Multiple local chat sessions
- Persistent chat history in `localcode.sessions.json`
- Follow-up prompts carry recent conversation context
- New / switch / delete chat controls
- Live tool activity while an agent run is active
- Run cancellation with **Stop**
- Configurable agent step limit

Chat history and settings remain local and are ignored by Git.

### Workspace tools

The agent can operate inside `./workspace` using:

- list files
- read files
- search text across the workspace
- create directories
- create or replace files
- rename files/directories
- delete files/directories

The workspace tree updates when files are changed externally or by the agent.

### Terminal tool

The agent can now request real terminal commands for builds, tests, compilers, package managers, and project tooling.

Terminal execution is approval-gated:

1. the model proposes the exact command
2. LocalCode pauses the run
3. the UI shows the exact command
4. you choose **Allow once** or **Deny**
5. approved commands execute with `workspace/` as their working directory
6. stdout, stderr, and exit code are returned to the agent

Commands time out after 120 seconds and the **Stop** button can cancel an active run.

Shell commands are intentionally treated differently from filesystem tools. A shell command starts in `workspace/`, but it is a real machine shell command and may still affect paths or programs outside the workspace. That is why command execution always requires explicit approval.

## Workspace boundary

`./workspace` is the only root exposed through LocalCode's filesystem APIs.

- absolute paths are rejected
- parent traversal is rejected
- symlink path components are rejected
- dropped files are detected live
- Monaco is used for manual editing
- Ctrl+S / Cmd+S saves the active file

## LM Studio

Default endpoint:

```text
http://127.0.0.1:1234/v1
```

Open **Settings** and use **Detect models** to query the local server.

## Windows

Start:

```text
StartLocalCode.cmd
```

Update:

```text
SyncFromGitHub.cmd
```

Local workspace contents, chats, settings, node modules, and sync backups are excluded from normal Git tracking.

## Next harness work

The next major layer is change review:

- before/after diffs for agent file writes
- changed-file summary per run
- easier rollback of an individual agent edit
- richer long-context compaction
- token streaming
