# LocalCode

LocalCode is a desktop, local-first coding agent and editor that talks directly to an OpenAI-compatible local model endpoint such as LM Studio.

## What it does

- Uses `./workspace` as the only editable project root.
- Automatically notices files and folders dropped into `workspace/` while the app is open.
- Opens and edits files with Monaco Editor.
- Supports Ctrl+S / Cmd+S for normal editor saves.
- Lets the local model read, create, overwrite, rename, and delete files inside `workspace/`.
- Rejects file operations that try to escape the workspace root.
- Ignores symlinks inside the workspace so they cannot be used to escape the sandbox.
- Connects directly to LM Studio at `http://127.0.0.1:1234/v1` by default.
- Can query the local server's `/models` endpoint from Settings and populate available model IDs.
- Model name, endpoint, API key, and temperature are configurable locally.

## Run

Requirements: Node.js 20+ and LM Studio (or another OpenAI-compatible local server).

```bash
npm install
npm run dev
```

Put any codebase you want LocalCode to work on inside:

```text
localcode/workspace/
```

Files dropped there should appear automatically. Then tell the agent what to build, fix, or change.

## LM Studio

Start the local server and load a coding-capable model. The default endpoint is:

```text
Base URL: http://127.0.0.1:1234/v1
API key:  lm-studio
```

Open **Settings** and press **Detect models** to test the endpoint and retrieve the model IDs reported by the local server.

The initial default model is `google/gemma-4-31b-qat`, but LocalCode is not tied to it.

## Security boundary

All app-managed file paths are canonicalized and checked against the `workspace` directory before filesystem access. Absolute paths and traversal attempts cannot be used to reach files outside that root through LocalCode's file IPC or agent actions.

Symlinks encountered inside `workspace/` are ignored by the file tree and agent inventory, and direct file operations reject symlink path components.

## Windows shortcuts

- `StartLocalCode.cmd` installs dependencies on first launch and starts the app.
- `PublishGitHub.cmd` initializes Git, signs into GitHub CLI if needed, creates `MAJWCF1234/localcode`, and pushes `main`.
- `SyncFromGitHub.cmd` fetches and fast-forwards from GitHub without force-resetting local source changes. Ignored local data such as `workspace/` and `localcode.settings.json` stay local.
