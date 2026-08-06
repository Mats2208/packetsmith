# Changelog

## 0.3.1

Distribution. 0.3.0 could only be run from a clone; this one installs.

### Added

- **Compiled binaries** that carry the Bun runtime inside — no Bun, no Node, no npm needed
  on the target machine. Seven targets, including musl for Alpine.
- **`curl | sh` and `irm | iex` installers.** They detect musl on Linux, because a glibc
  binary on Alpine does not start and the error does not say why. They do **not** edit
  anyone's shell profile — they print the PATH line and name the file it goes in.
- **npm**: `npm i -g packetsmith` or `bun add -g packetsmith`. A Node launcher plus one
  package per platform as optional dependencies, so npm downloads the ~100 MB that matches
  your machine instead of all seven.
- **`packetsmith setup`** as a subcommand. Whoever installs a binary does not have the repo,
  so `bun run setup` was not an option for them and they had no way to install the MCP.
- A release workflow that typechecks and tests before building. A broken release is worse
  than a late one.

### Fixed

- **Three tests passed on Windows and failed on Linux.** `bun test` evaluates every test
  module in one process, so a module-scope `process.env.X` in one file is visible to the
  rest, and which one wins depends on file-walk order — which differs by platform.
- A type error in `scripts/setup.ts` that nobody saw because the file was not in the import
  graph of anything that got compiled.

## 0.3.0

The release where PacketSmith stops being an interface for one agent CLI and becomes an
agent that can talk to ~150 providers.

### Added

- **Own agent loop.** PacketSmith spawns the MCP server itself, runs the tool loop and
  speaks HTTP straight to a provider. The `claude` CLI engine stays, because a Claude
  Pro/Max subscription has no API and driving the CLI is the only way to spend it.
- **Providers have plans.** A provider is who answers you; a plan is the door you come in
  through and how you pay — it carries the URL, protocol, models, price, authentication and
  usage meter. Kimi is one provider with two plans, not two providers.
- **Three wire protocols**: OpenAI `/chat/completions`, Anthropic `/v1/messages`, and
  OpenAI Responses for the ChatGPT coding plan.
- **ChatGPT Plus/Pro** via device login — a code you enter in a browser, no API key. Chosen
  over the browser-redirect flow because that one needs a local HTTP server on a fixed port,
  which does not work over SSH or in WSL.
- **Usage meters.** `/usage`, plus the status bar gauge. On a subscription there is no
  per-token price to count, so without this the plan was a black box until a turn got cut
  off. Verified live against Kimi Code.
- **~150 providers**, discovered from models.dev rather than written down. A provider needs
  an HTTPS base URL, documented env vars, a tool-calling model, and a protocol we speak.
- **Live model lists** from models.dev, cached and refreshed in the background. `/model`
  shows each model's context window and price.
- **`/usage`**, and `/debug` now reports version and platform and is a paste-ready markdown
  table for bug reports.
- **`docs/`** — nine pages: getting started, commands, providers and plans, architecture,
  the system prompt, themes, development, troubleshooting.

### Changed

- **The command palette is a list, not a board.** On a board `←→` meant *the one next to it*
  and `⇅` meant *another family*, so moving between neighbours could cost a family jump and
  a jump back. Every row now carries its own description, groups have headers, and the
  window has an `n/N` counter — which matters when `/engine` has 150 entries.
- **The header names what it shows**: `PROVIDER KIMI/CODING · MODEL K3 · EFFORT HIGH`.
- The model is saved **per engine**.
- `--help` no longer prints 150 engine names on one line.

### Fixed

- **The published package did not start.** Bun does not read a `tsconfig.json` from inside
  `node_modules`, so every `.tsx` fell back to looking for React's runtime. Found by
  packing, installing and running — nothing in the repo could have caught it.
- **A paste with a dialog open** landed in the dialog *and* in the message field, leaving an
  API key visible and one Enter away from being sent to the agent.
- **The header showed the wrong model.** `"…"` is a non-empty string, so it won the `||`
  against the model you had actually picked.
- **The usage bar kept the previous engine's numbers.** It was mounted once; it now follows
  the active engine and clears before asking.
- **`sonnet` asked of Kimi.** The chosen model was saved globally instead of per engine.
- **`.gitignore` did not cover `AUTH.txt` or `auth.json`** — one distracted `git add -A`
  from publishing a key.

### Known limits

- Of the ~150 providers, **seven are verified**; the rest are built from the models.dev
  catalog and have not been run. If one fails, please
  [open an issue](https://github.com/Mats2208/packetsmith/issues) with the output of
  `/debug`.
- The **ChatGPT plan** — device login and the Responses protocol — is written against
  Codex's real surface but has never been executed against a live subscription.
- One MCP client can hold the Packet Tracer bridge port at a time. Close Claude Code,
  Cursor or Claude Desktop before using PacketSmith.
- Single session. No packaged binary.

## 0.2.0

Command palette behind `/`, 13 themes with contrast enforced as a test, two languages,
`/connect` for API keys, and the first HTTP provider.

## 0.1.0

The split-screen TUI: streaming chat on the left, topology derived from `pt_*` tool results
on the right. Fabric tree, device list, canvas plan from Packet Tracer's own coordinates,
activity and budget meters, per-turn timing.
