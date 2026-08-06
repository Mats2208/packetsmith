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
| `src/engine/` | every engine, of both classes below. All of them emit `AgentEvent`. |
| `src/engine/providers/` | the three LLM wire protocols, the provider/plan table (`catalog.ts`), the live model catalog (`models-dev.ts`), the usage meters (`usage.ts`) and the ChatGPT device login. |
| `src/mcp/` | our own MCP client over stdio. Declares no tools — it asks the server for them. |
| `src/topology/` | the network model, built from `pt_*` tool results. No rendering logic. |
| `src/tui/` | OpenTUI + Solid components. No business logic. |

## Architecture, in one paragraph

Engines come in **two classes**, and the difference decides where the agent loop lives.

`claude` **wraps** an agent that already exists: the CLI runs the loop, talks to the MCP and
resolves permissions, and we read its stream. It is the only way to spend a Pro/Max
subscription, because that subscription has no API — opencode did not find a way around it
either, its own dialog labels Anthropic `"(API key)"`.

Every other engine **is** the agent (`src/engine/agent.ts`). It spawns the MCP server
itself, runs the tool loop and speaks HTTP straight to a provider. What that buys is a
system prompt that is ours, the tools we choose, and a loop you can read.

Both emit the same `AgentEvent` union, so the interface never learns which one is running.
The left panel renders the conversation; the right panel derives the topology from the
`tool_end` events of `pt_*` calls.

**No tool is ever declared in this repo.** The MCP server is asked (`tools/list`) and its 61
tools arrive with their JSON Schema already attached — which is exactly the shape function
calling wants. When MCP-Packet-Tracer adds tool 62 it shows up on its own: nothing to sync,
no mirror to rot.

### Known limitation: one MCP client at a time

The Packet Tracer MCP binds `127.0.0.1:54321` and only one process can hold it. **The port
belongs to the Python server, not to Packet Tracer** — verified in its source — so two live
servers fight over it.

That is why the old rule was "the TUI never talks to the MCP": with the `claude` CLI in the
middle, opening a second client meant a second server. With an HTTP engine the CLI is not
running, so there is exactly one server and the rule falls away by itself.

From outside, the constraint still bites. If Claude Code (or Cursor, or Claude Desktop) is
running with the Packet Tracer MCP configured, **it already owns `:54321`**, our MCP
instance cannot bind, and every `pt_*` call answers:

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

## The argv trap that silently unconfigured everything

**This one is Windows-only, and that is exactly why it survived.** On macOS and Linux
`claude` is a real executable and everything below works as written; the project is
developed on macOS, so nothing here ever looked broken.

On Windows, `npm i -g` does not put an executable on the `PATH` — it puts a `.cmd`
shim that forwards `%*`. **cmd.exe cannot carry a newline inside an argument:** it
truncates the command line there and drops everything after it.

`--append-system-prompt` takes a multi-line value. While it sat in the middle of the
argument list, everything after it was silently lost:

| Flag | What its loss looked like |
|---|---|
| `--mcp-config` / `--strict-mcp-config` | all 11 of the user's MCP servers loaded — 315 tools, 219 of them foreign |
| `--model` | asked for `sonnet`, got the default |
| `--allowedTools` | no allowlist at all |

Nothing errored. Measured on Windows: `1 server / 96 tools / 0 foreign` after the fix,
against `11 / 315 / 219` before.

**Both platforms, every time.** A change that only ever runs on the author's machine
is how this stayed hidden through several releases. `bun test` covers the split with
`resolveBin`'s platform argument, so at minimum assert the other OS instead of assuming
it.

Two rules come out of it, and both are load-bearing:

- **spawn the real executable, not the shim** (`resolveBin` in `src/engine/claude.ts`);
- **any argument whose value can contain a newline goes LAST.** Then the worst case is
  that argument truncating itself, not taking four others with it.

If you add a flag, add it *before* `--append-system-prompt`, and check it actually
arrived — pass a deliberately invalid value and confirm the CLI complains. A flag that
never reaches the CLI fails the same way this one did: perfectly quietly.

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

### What real Packet Tracer output has that a fixture does not

Two things bit here, both from a stock PT 9.0 workspace, neither present in the
hand-written fixture:

- **Device names contain spaces.** `PC Ventas` is an ordinary name. A `\S+` in the
  device regex did not just drop the device — the *port* line below it still matched,
  so its interfaces and IPs were attributed to the device above. The panel showed one
  machine's address on another. Any parser change here gets tested against
  `EXPORT_REAL` in `test/topology.test.ts`, which is literal PT output.
- **PT adds its own pseudo-device.** Every topology carries a
  `Power Distribution Device0` at `(3899, 3900)`. It is not part of the network and it
  is far outside the usable canvas, so including it flattens the whole plan into one
  corner — the span becomes 3900 and every real device lands in the same column.

`src/topology/tree.ts` answers **what hangs off what** — the sidebar tree.
`src/topology/map.ts` answers **how it is laid out** — a plan drawn from the real `x, y` of
the Packet Tracer canvas, under the reply that changed it.

They are not redundant. An uplink crossing from one edge of the canvas to the other is
obvious in the plan and invisible in the tree; which switch a host hangs off is obvious in
the tree and a guess in the plan. Both need **links**, which is why the system prompt insists
on `pt_export_topology` — `pt_query_topology` counts links but does not return them.

The sidebar splits the same data twice more: **FABRIC** is the scaffold (icon and name, no
addresses) and **DEVICES** is the per-device config (model, interfaces, IPs). Mixing them
buried the scaffold under addresses and scattered the addresses across branch ends.

### When the plan gets drawn

Three conditions, all required, and this is the whole rule:

1. at least two devices, **and** at least one link — without links there is no shape;
2. some device has a non-zero coordinate — `pt_query_topology` returns everything at (0,0),
   which would stack the whole network onto one cell;
3. the layout **changed** since the last plan drawn (`layoutKey` — names, coordinates, link
   count). Moving one device counts; that is exactly what the plan exists to show.

Condition 3 is why an unchanged network drawn twice only appears once. Repeating an identical
figure under every reply turns it into wallpaper and it stops being looked at. The sidebar
always holds the current state; the plan is a log of what changed.

## Conventions

- **Code comments in Spanish. Public docs (README, AGENTS.md, issues) in English.**
- Comments explain **why**, never what. A comment that records a trap ("this fails on Warp
  because…") is worth its weight in gold; `// increment i` is noise.
- Commits are **atomic**: one reason to change per commit. The message explains *why* the
  change was needed, not what the diff already shows.
- Never swallow an error silently. A parser that skips a malformed line must say so.

## Engine adapters

Adding an engine that **wraps a CLI** is one file plus one line in `src/engine/index.ts`.
Adding an engine that **is** the agent is a few lines in `src/engine/providers/catalog.ts`.

That table has **two levels, and the difference is load-bearing**:

- a **provider** is who answers you — Kimi, OpenAI, Z.AI;
- a **plan** is the door you come in through and how you pay — the coding subscription, the
  metered API, the ChatGPT plan. It changes the URL, the protocol, the models, the price,
  and even how you authenticate.

Everything that varies lives on the plan. Flattening the two was a real bug: `kimi` and
`moonshot` shipped as two providers in `/engine` when they are one company charging two
ways, and a key for one 401s against the other.

The contract:

```ts
interface Engine {
  readonly name: string
  start(opts: StartOpts): Session
  describe?(): Record<string, string>   // shown by /debug
  models?(): { value: string }[]        // offered by /model
  sinCostoPorToken?: boolean            // subscription: hide the $ counter
}

interface Session {
  send(text: string): boolean           // false = the CLI is gone
  events(): AsyncIterable<AgentEvent>
  close(): void
}
```

Two things are load-bearing.

`events()` **must** be an `AsyncIterable`, not a promise of the final result. If an adapter
collects everything and yields at the end, the right panel cannot react while the agent
works — and that is the feature.

`send` returns whether the message got anywhere. Writing to the stdin of a dead process
does **not** throw — measured — so without that boolean the message vanishes, the UI waits
for a reply that will never come, and the app locks with the input field disabled.

`StartOpts` carries `model`, `effort` and `resume`. `resume` is what makes `/model` worth
having: the model is a launch argument, so it cannot change in place, but relaunching the
process on the same session id keeps the conversation. Verified against the real CLI —
give haiku a fact, relaunch with sonnet, it still remembers.

Each CLI has its own output format and its own quirks. Say which engine you tested with;
they do not behave the same.

### The three LLM protocols

`protocolo` on the plan picks one. They are not variants of one format.

| | OpenAI (`/chat/completions`) | Anthropic (`/v1/messages`) | Responses (`/responses`) |
|---|---|---|---|
| system | a message | its own top-level field | `instructions` |
| history | messages with roles | messages with roles | a flat list of **items** |
| tools | `function.parameters` | `input_schema` | flat `{type,name,parameters}` |
| streaming | deltas on `choices` | typed block events | named events |
| token usage | needs `stream_options.include_usage`, in a chunk with no `choices` | `message_start` / `message_delta` | `response.completed` |

Subscription coding plans expose whatever surface their vendor's CLI uses; metered APIs
expose the OpenAI one. **Kimi Code (`sk-kimi-` keys, `api.kimi.com/coding`) is Anthropic
and is a different product from the Moonshot platform** — each key 401s against the other's
endpoint. **The ChatGPT plan is Responses**, at `chatgpt.com/backend-api/codex/responses`,
and has no API key at all: it is an OAuth device login whose access token expires hourly.

Four traps, each of which breaks a naive implementation:

- **OpenAI:** a tool's arguments do not arrive whole. Accumulate them by **index** — not by
  id, which is missing from the middle deltas — as raw text, and parse only at close.
- **Anthropic:** every tool result goes in **one** user message. Sent one per message, the
  next request is rejected.
- **Anthropic + extended thinking:** `thinking` blocks must be returned **verbatim, with
  their signature**. Rebuilding the assistant message from text plus tool calls gives a 400.
  Kimi K3 thinks by default, so this is not an edge case — it is every turn.
- **Responses + `store: false`:** same shape, different name. We do not leave the
  conversation on anyone's server, so `reasoning` items must be echoed back with their
  `encrypted_content` — which is why the request asks for
  `include: ["reasoning.encrypted_content"]`.

The last three only break on the **second** loop iteration, after tools already ran against
Packet Tracer. `test/anthropic.test.ts` and `test/providers.test.ts` build that
second-iteration history by hand.

### The palette is a list, not a board

It was a board — every command visible at once, grouped by family, two rows. It looked good
and was annoying to use: on a board `←→` means *the one next to it* and `⇅` means *another
family*, so moving between two options that read as neighbours could cost a family jump and
a jump back. Hands expect `⇅` to walk options.

It is a list now, and the four things that make it not a plain list are the point:
a row per option **with its description** (comparing two used to mean moving back and
forth), a family header where the family changes, a scrolling window with an `n/N` counter,
and the typed filter visible at the top instead of hidden in a corner.

`listado()` is pure and exported for exactly one reason: a bad scroll offset puts the
cursor outside the window and the list looks frozen. That is tested without mounting
anything.

The counter is not decoration either — `/engine` now lists ~150 providers.

### Model lists are fetched, not written

A hardcoded model list is born stale — this repo offered `glm-4.6` while Z.AI was already
shipping `glm-5.2`, and nothing failed loudly. `src/engine/providers/models-dev.ts` reads
the live catalog from **models.dev** (the same source opencode uses), caches it under
`~/.packetsmith/models.json`, and refreshes in the background when the copy is over 12h
old. The list in `catalog.ts` is only the offline fallback.

It also filters on `tool_call`: a model that cannot call tools cannot drive Packet Tracer,
and offering it in `/model` offers something that fails on the first turn.

**Providers are discovered the same way.** `todosLosProveedores()` returns the six curated
ones — the only place a plan, a protocol override or a usage meter can be declared — plus
every models.dev provider that has an HTTPS base URL, documented env vars, a tool-calling
model, and an SDK whose protocol we actually speak. That last filter is a *whitelist*: a
provider on `@ai-sdk/amazon-bedrock` speaks something this repo does not implement, and
offering it would fail on the first message.

### The model is saved per engine

`config.json` stores `models: { claude: "sonnet", kimi: "k3" }`, not one `model`. The flat
version was a bug with teeth: pick `sonnet` under Claude, switch to Kimi, restart, and the
app asked Kimi for a model called `sonnet`. Aliases from one provider do not exist in
another. Old configs migrate to the engine they were saved under, and only that one.

### Usage meters

With the `claude` CLI the plan gauge came from an Anthropic endpoint. With our own
providers nothing arrived, and on a **subscription** that is worse than on a metered API —
there is no per-token price to count, so the bar read `$0.0000` and nothing told you how
much was left until a turn got cut off.

Each plan says where its number comes from (`medidor` in the catalog), and `usage.ts`
normalizes wildly different shapes — percentages, dollar balances, absolute quotas — into
the one the status bar already knows how to draw. Verified live: Kimi Code answers
`GET /coding/v1/usages` with a 5-hour window and a weekly one.

If the endpoint does not answer, the meter turns off and the app carries on. A meter is
information, not a dependency.

## Related projects

PacketSmith drives [MCP-Packet-Tracer](https://github.com/Mats2208/MCP-Packet-Tracer),
which is what actually talks to Packet Tracer. Bugs in device handling, topology deployment
or the PT bridge belong **there**, not here. This repo owns the agent wrapper and the UI.
