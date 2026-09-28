# LocalCode

LocalCode is a desktop, local-first coding agent and editor that talks directly to an OpenAI-compatible local model endpoint such as LM Studio.

## What it does

- Uses `./workspace` as the only editable project root.
- Automatically shows files and folders placed in `workspace/`.
- Opens and edits files with Monaco Editor.
- Lets the local model read, create, overwrite, rename, and delete files inside `workspace/`.
- Rejects file operations that try to escape the workspace root.
- Connects directly to LM Studio at `http://127.0.0.1:1234/v1` by default.
- Model name, endpoint, and API key are configurable in the GUI.

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

Then open LocalCode and tell the agent what to change.

## LM Studio

Start the local server, load a coding-capable model, then configure LocalCode with:

```text
Base URL: http://127.0.0.1:1234/v1
API key:  lm-studio
Model:    your exact loaded model identifier
```

The default model is `google/gemma-4-31b-qat`, matching the initial prototype target.

## Security boundary

All app-managed file paths are canonicalized and checked against the `workspace` directory before filesystem access. Absolute paths and traversal attempts cannot be used to reach files outside that root through LocalCode's file IPC or agent actions.

## Windows shortcuts

- `StartLocalCode.cmd` installs dependencies on first launch and starts the app.
- `PublishGitHub.cmd` initializes Git, signs into GitHub CLI if needed, creates `MAJWCF1234/localcode`, and pushes `main`.
