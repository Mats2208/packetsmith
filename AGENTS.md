# AGENTS.md

Instructions for AI coding agents working on this repository.

## The prime directive

**Minimal functional code. No bloat.**

Before adding anything, ask whether it earns its weight. Do not add:

- abstractions with a single caller
- a dependency for something 20 lines of stdlib can do
- config options nobody asked for
- defensive code for cases that cannot happen
- comments that restate the code

**Dead code is a bug.** If a UI element exists, something must render it. If a function
exists, something must call it.

## Before you claim it works

This app spawns a real agent CLI and reads its output stream. **Typechecking proves almost
nothing here** — the interesting failures are in what the CLI actually emits.

```bash
bun run typecheck
bun test
bun run src/index.ts     # then USE it
```

A change to the engine is not done until you have watched real events arrive **while** the
agent is working, not after it finished. That distinction is the whole point of this project.

## Where things are

| | |
|---|---|
| `src/engine/` | spawns the agent CLI and turns its output into `AgentEvent`. One file per engine. |
| `src/topology/` | the network model, built from `pt_*` tool results. No rendering logic. |
| `src/tui/` | OpenTUI + Solid components. No business logic. |

## Architecture, in one paragraph

PacketSmith does **not** implement an agent loop. It spawns an existing agent CLI
(`claude`, later `codex` / `opencode`) in streaming mode and translates whatever that CLI
emits into a single `AgentEvent` union. The left panel renders the conversation; the right
panel derives the network topology from the `tool_end` events of `pt_*` calls.

**The TUI never talks to the MCP server directly.** The Packet Tracer MCP binds
`127.0.0.1:54321` and only one process can hold it — opening our own client would spawn a
second server instance and the two would fight over the port. Everything the right panel
needs already arrives in the agent's stream.

### Known limitation: one MCP client at a time

The same constraint bites from outside. If Claude Code (or Cursor, or Claude Desktop) is
running with the Packet Tracer MCP configured, **it already owns `:54321`**. PacketSmith's
agent then spawns its own MCP instance whose bridge cannot bind the port, and every `pt_*`
call answers:

```
Packet Tracer no está conectado por ningún canal.
```

Measured, not guessed: two `packet_tracer_mcp` processes alive, one holding the port.

This is not a bug we can fix here — it is how the MCP's HTTP bridge works. Close other MCP
clients before using PacketSmith. When testing the topology pipeline while another client
holds the port, use the fixture in `test/topology.test.ts` instead of a live export.

## OpenTUI traps, measured

Every one of these cost a rendering session to find, and none of them is visible to
`tsc`. Run `bun run preview` after touching `src/tui/` — it prints the real character
frames for three fixed states in about a second, no Packet Tracer and no tokens.

| Trap | What you see | The rule |
|---|---|---|
| Sibling `<text>` without `flexDirection: "row"` | a 3-line wordmark drawn as 1 line | rows are explicit, never implied |
| A box wrapping multi-row content with no `height` | the block below overwrites its last row | any box holding N rows declares `height: N` |
| A wrapper box added just for `marginTop` | same collapse, one level up | margins are props on the art component, not extra boxes |
| Anything placed **after** a `scrollbox` | never drawn at all | status goes above the scrollbox, always |
| Text overflowing a fixed-width panel | the line wraps and the grid breaks | truncate with `…` before you overflow |

Two that are useful rather than hostile: a `flexGrow` box **clips** its overflowing child,
which gives width-independent fillers without measuring the terminal; and `border: ["left"]`
with `customBorderChars` gives a single rule instead of a box.

### Input, specifically

| Trap | What you see | The rule |
|---|---|---|
| `virtualLineCount` read inside `onContentChange` | always the previous value — the box never grows | count wrapped rows yourself (`visualRows`); the renderable updates one frame later |
| Keybinding without a modifier listed before one with it | `Shift+Enter` submits instead of inserting a newline | first match wins — put the *specific* binding first |
| Relying on `Shift+Enter` alone | works in your terminal, submits half a message in the user's | without the kitty keyboard protocol the modifier never arrives; always bind `Alt+Enter` and `Ctrl+J` too |

`testRender` gives you `mockInput.typeText` / `pressKey` / `pressEnter`, and
`{ kittyKeyboard: true }` to exercise modifier-aware bindings. Input behaviour is testable —
test it, because every trap above was found that way and none of them is visible to `tsc`.

## What the CLI already tells you

Claude Code's `stream-json` carries far more than text and tool calls. These were all being
thrown away, and each one replaced something we would otherwise have had to fake:

| Event | Carries | Used for |
|---|---|---|
| `system` / `status` | `requesting` | the only stretch with no other signal — request in flight |
| `stream_event` / `content_block_start` | `thinking` \| `text` \| `tool_use` | what the agent is doing right now |
| `system` / `thinking_tokens` | `estimated_tokens` | proof of life while there is no text yet |
| `rate_limit_event` | window, status, reset time | plan quota, with **no** OAuth token read and no extra endpoint |
| `result` / `usage` + `modelUsage` | token counts, `contextWindow` | context gauge |

Before adding a mechanism, check whether the stream already reports it. Dump a real run with
`claude -p --output-format stream-json --include-partial-messages --verbose` and look.

**Not in the stream:** the percentage of the plan's quota already consumed. `rate_limit_event`
carries the window, its status and the reset time — enough for a countdown, not for a gauge.
The percentage lives behind `GET https://api.anthropic.com/api/oauth/usage` (`src/engine/quota.ts`),
which needs the OAuth token the CLI stored at login.

Rules for that path, and they are not negotiable:

- The token is read, sent to `api.anthropic.com`, and dropped. Never stored, printed or logged.
- The cheap source is tried first (`~/.claude/.credentials.json`), then the macOS Keychain.
  Reaching for the Keychain pops a system dialog, and popping one before exhausting the free
  option is rude.
- Denying the dialog is a supported outcome, not an error: the app falls back to the
  countdown. Same if you never logged in. `PACKETSMITH_NO_QUOTA=1` skips the lookup entirely.
- **Nothing under `test/` or `scripts/` may reach for it.** A test has no right to trigger a
  system permission prompt — that is why `App` takes a `quota` prop, and why the preview
  passes one.
- The cache keeps the last good value on any failure and backs off for five minutes after a
  429. Without it the meter vanished exactly when it mattered: near the cap is when you check
  most and when the endpoint fails most.

## "It feels slow" — measure before you touch anything

Three places can eat a turn, and they need opposite fixes. Numbers below are measured,
not estimated; rerun them before trusting them.

| Suspect | How to check | Measured |
|---|---|---|
| Our event consumption | `bun run bench` | **129k events/s** — 2600× more than the CLI can emit. Not it. |
| MCP server startup | `claude -p --verbose` and read `ttft_ms` | 178 tools / 7 servers → **4.76s**; scoped to 1 → **1.99s** |
| The bridge, per call | the `⏱` line under a turn | every `pt_*` is one HTTP round-trip to PT, strictly serial |

PacketSmith runs in a **separate process** from `claude`, so slow rendering cannot make the
model think slower. The only way we could is backpressure — failing to drain its stdout fast
enough that the CLI blocks on write. That is what `bun run bench` exists to rule out.

`pt_live_deploy` verifies **one device and one link at a time**. A 43-node topology is 85
sequential round-trips before it returns. That is the MCP's design, not something this repo
can fix from here — but it is why "the agent is slow" is usually "Packet Tracer is slow".

The `⏱` line under any turn over 20s splits it: time in Packet Tracer vs time in the model.
Read it before optimizing anything.

## Two views of the same network, on purpose

`src/topology/tree.ts` answers **what hangs off what** — the sidebar tree.
`src/topology/map.ts` answers **how it is laid out** — a plan drawn from the real `x, y` of
the Packet Tracer canvas, under the reply that changed it.

They are not redundant. An uplink crossing from one edge of the canvas to the other is
obvious in the plan and invisible in the tree; which switch a host hangs off is obvious in
the tree and a guess in the plan. Both need **links**, which is why the system prompt insists
on `pt_export_topology` — `pt_query_topology` counts links but does not return them.

## Conventions

- **Code comments in Spanish. Public docs (README, AGENTS.md, issues) in English.**
- Comments explain **why**, never what. A comment that records a trap ("this fails on Warp
  because…") is worth its weight in gold; `// increment i` is noise.
- Commits are **atomic**: one reason to change per commit. The message explains *why* the
  change was needed, not what the diff already shows.
- Never swallow an error silently. A parser that skips a malformed line must say so.

## Engine adapters

Adding an engine is one file plus one line in `src/engine/index.ts`. The contract:

```ts
interface Engine {
  name: string
  run(opts: RunOpts): AsyncIterable<AgentEvent>
}
```

It **must** be an `AsyncIterable`, not a promise of the final result. If an adapter collects
everything and yields at the end, the right panel cannot react while the agent works — and
that is the feature.

Each CLI has its own output format and its own quirks. Say which engine you tested with;
they do not behave the same.

## Related projects

PacketSmith drives [MCP-Packet-Tracer](https://github.com/Mats2208/MCP-Packet-Tracer),
which is what actually talks to Packet Tracer. Bugs in device handling, topology deployment
or the PT bridge belong **there**, not here. This repo owns the agent wrapper and the UI.
