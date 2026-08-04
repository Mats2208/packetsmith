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
