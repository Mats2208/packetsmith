# Architecture

## Two kinds of engine

The difference decides where the agent loop lives.

```
 /engine claude — wraps an agent that already exists
   PacketSmith ──spawn──> claude --output-format stream-json
                             └──> claude ──stdio──> MCP ──HTTP:54321──> Packet Tracer

 /engine kimi · openai · … — IS the agent
   PacketSmith ──HTTPS──> provider
        └──loop──> MCP ──stdio──> ──HTTP:54321──> Packet Tracer
```

**`claude` wraps.** The CLI runs the loop, talks to the MCP and resolves permissions; we
read its stream. It exists for one reason: a Claude Pro/Max subscription has no API, so
driving the CLI is the only way to spend it. opencode did not find a way around this
either — its own dialog labels Anthropic `"(API key)"`.

**Everything else is the agent** (`src/engine/agent.ts`). It spawns the MCP server itself,
runs the tool loop, and speaks HTTP straight to a provider. What that buys is a system
prompt that is ours — the CLI's talks about editing files and git — the tools we choose,
and a loop you can read.

Both emit the same `AgentEvent` union, so the interface never learns which one is running.

## No tool is declared in this repo

The MCP server is **asked** (`tools/list`) and its 61 tools arrive with their JSON Schema
already attached — which is exactly the shape function calling wants. When
MCP-Packet-Tracer adds tool 62, it shows up on its own: nothing to sync, no mirror to rot.

Where to launch it from comes from `~/.claude.json`, which `bun run setup` already wrote.
There is no second configuration saying the same thing twice.

## One MCP client at a time

The Packet Tracer MCP binds `127.0.0.1:54321` and only one process can hold it. **The port
belongs to the Python server, not to Packet Tracer** — verified in its source — so two live
servers fight over it.

That is why the old rule was "the TUI never talks to the MCP": with the CLI in the middle,
opening a second client meant a second server. With an HTTP engine the CLI is not running,
so there is exactly one server and the rule falls away by itself.

From outside, the constraint still bites. If Claude Code, Cursor or Claude Desktop is
running with the MCP configured, **it already owns the port**, ours cannot bind, and every
`pt_*` call answers `Packet Tracer no está conectado por ningún canal.` Measured, not
guessed: two `packet_tracer_mcp` processes alive, one holding the port.

Close other MCP clients before using PacketSmith.

## The topology pipeline

The right panel is **derived**, never polled:

```
tool_end (pt_*) ─▶ ingest ─▶ Topology ─▶ fabric tree + device list + canvas plan
```

`ingest` is pure and takes the tool output as it arrived. Real Packet Tracer output differs
from a tidy fixture in ways that cost a debugging session to find — device names with
spaces, an internal power device that is not a network device, lines that do not parse at
all — so the parser is written against a real export, and `test/topology.test.ts` keeps one.

Two views exist because they answer different questions. The **fabric tree** answers *what
hangs off what*; the **canvas plan** answers *how it is laid out*, drawn from Packet
Tracer's own `x, y`. An uplink crossing the canvas is obvious in the plan and invisible in
the tree; which switch a host hangs off is obvious in the tree and a guess in the plan.

The plan is drawn only when the layout **changed**. Repeating an identical figure under
every reply turns it into wallpaper and it stops being looked at.

## Where things are

| | |
|---|---|
| `src/engine/` | every engine, of both classes. All emit `AgentEvent` |
| `src/engine/providers/` | the three wire protocols, the provider/plan table, the live model catalog, the usage meters, the ChatGPT device login |
| `src/mcp/` | our MCP client over stdio. Declares no tools — asks for them |
| `src/topology/` | the network model, built from `pt_*` results. No rendering |
| `src/tui/` | OpenTUI + Solid components. No business logic |

## The engine contract

```ts
interface Engine {
  readonly name: string
  start(opts: StartOpts): Session
  describe?(): Record<string, string>   // /debug
  models?(): { value: string; description?: string }[]
  uso?(): Promise<Medida | undefined>   // the plan gauge
  planActual?(): string | undefined     // shown in the header
  sinCostoPorToken?: boolean            // subscription: hide the $ counter
}

interface Session {
  send(text: string): boolean           // false = it is gone
  events(): AsyncIterable<AgentEvent>
  close(): void
}
```

Two things are load-bearing.

`events()` **must** be an `AsyncIterable`, not a promise of the final result. An adapter
that collects everything and yields at the end leaves the right panel frozen while the
agent works — and reacting while it works is the feature.

`send` returns whether the message got anywhere. Writing to the stdin of a dead process
does **not** throw — measured — so without that boolean the message vanishes, the UI waits
for a reply that will never come, and the app locks with the input disabled.

## Measured, not assumed

| | |
|---|---|
| Event consumption | **129k events/s** — 2600× more than the CLI can emit, so we are never the bottleneck (`bun run bench`) |
| MCP scoping | 178 tools / 7 servers → **4761 ms** to first token; scoped to Packet Tracer alone → **1989 ms** |
| Where a turn goes | the `⏱` line splits it: time in Packet Tracer vs time in the model |

Every `pt_*` call is one HTTP round-trip to Packet Tracer, strictly serial —
`pt_live_deploy` verifies one device and one link at a time. That is usually what "the
agent is slow" actually means.
