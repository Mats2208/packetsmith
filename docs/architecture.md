---
description: How PacketSmith works: two engine classes, the MCP tool loop, and why the topology panel is derived from real tool results instead of dictated by the model.
---

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

## The panel is derived, not dictated

**The agent never formats anything for the panel.** There is no agreed-upon block, no
`MODULE=…` envelope, no "reply with this structure and then your prose". The panel is fed
from the raw result of every `pt_*` tool call:

```ts
// app.tsx
if (!ev.isError) setTopology((cur) => ingest(cur, ev.name, ev.output))
```

`ev.output` is exactly what the MCP server returned. The model does not know anyone is
reading it. The system prompt tells it the **opposite** of "emit structured data":

> Do NOT repeat the list of devices, IPs or links: the panel on the right already shows
> them. Say what changed and what you verified, not the inventory.

Four reasons this is not a stylistic preference:

**It cannot be hallucinated.** If the model says *"I created R1 and linked it to the
switch"* but `pt_add_device` failed, the panel does **not** show R1. With a block the model
writes, the panel would show what the model *believes* it did. The house rule is verify
against the device, not against the plan — the panel is that rule turned into code.

**It costs nothing.** A structured block would be re-emitted every turn. With fourteen
devices that is a meaningful slice of context spent restating what we already parsed.

**It fills in mid-turn.** `tool_end` events arrive while the agent is still working, so the
panel populates device by device during a build. A block at the end of the reply would
leave the panel empty until the model finished writing — and that wait is exactly when
there is something worth watching.

**It survives a model that drifts.** Small, cheap models wander off an output format by the
third turn. A regex over a tool result does not care how disciplined the model is.

What the prompt *does* steer is **which tool to call** — `pt_export_topology` over
`pt_query_topology`, because only export carries the links. That is guiding the action, not
the output. If the agent calls the other one anyway, the panel degrades to a flat list
instead of breaking.

The agent's prose, meanwhile, goes to the chat **literally**, rendered as markdown. That
half is exactly what the model wrote.

### The pipeline

```
tool_end (pt_*) ─▶ ingest ─▶ Topology ─▶ fabric tree + device list + canvas plan
```

`ingest` is pure: current topology in, tool name and raw output in, new topology out. It
listens to several tools, because the agent picks whichever fits what it is doing and in
practice rarely calls `pt_export_topology` at all:

| tool | what it carries |
|---|---|
| `pt_full_build` | the whole plan as JSON — devices **and** links |
| `pt_export_topology` | text with devices and links |
| `pt_query_topology` | devices only, **no** links |
| `pt_add_link` / `pt_delete_link` | incremental updates during a build |

v0.1 watched only `pt_export_topology`, so a real deploy — which uses `full_build` and
`query_topology` — left the panel empty while the network existed on screen.

### The price of parsing real output

Reading Packet Tracer's text is more fragile than reading a JSON shape you asked for, and
that is the trade. The regexes are written against **real** output, not a tidy fixture,
because the difference is where the bugs live:

- **Device names with spaces** are legal and common in PT (`PC Ventas`, `SW Piso 2`). With
  `\S+` that line did not match, so the device vanished from the panel — *and* its port
  lines, which did match, were attributed to the **previous** device. The panel was not
  just hiding a device; it was giving its interfaces and IPs to another one.
- **`Power Distribution Device`** is a pseudo-device PT adds to every topology, parked at
  `(3899, 3900)` while a real lab lives between 100 and 700. Including it made the canvas
  span 3900 and crushed every real device into one column, plus an `OTHERS: 1` nobody
  placed.

Both are filtered on purpose now and both are covered by tests against real output.

### Two views, two questions

The **fabric tree** answers *what hangs off what*. The **canvas plan** answers *how it is
laid out*, drawn from Packet Tracer's own `x, y`. An uplink crossing the canvas is obvious
in the plan and invisible in the tree; which switch a host hangs off is obvious in the tree
and a guess in the plan.

The plan is drawn only when the layout **changed** — moving one device counts. Repeating an
identical figure under every reply turns it into wallpaper and it stops being looked at.

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
