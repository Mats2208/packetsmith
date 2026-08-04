<div align="center">

# PacketSmith

**Describe a network in plain language and watch the topology build itself — live, in your terminal.**

A terminal agent for **Cisco Packet Tracer**. Talk to it on the left, see the network take
shape on the right.

[![Status](https://img.shields.io/badge/status-alpha-e8a33d?style=flat-square)](https://github.com/Mats2208/packetsmith)
[![Bun](https://img.shields.io/badge/Bun-000000?style=flat-square&logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/github/license/Mats2208/packetsmith?style=flat-square&color=green)](LICENSE)

</div>

---

```
┌──────────────────────────────────┬──────────────────────────────┐
│ › crea 3 routers con OSPF y DHCP │ TOPOLOGÍA  8 equipos · 7 enl │
│                                  │ ▲ pt_export_topology         │
│   ✓ pt_list_devices              │                              │
│   ✓ pt_full_build                │ ◆ R1  10.0.0.1 192.168.0.1   │
│   ● pt_export_topology           │ └ ▣ SW1                      │
│                                  │   ├ ▪ PC1  192.168.0.3       │
│ Listo: 31/31 equipos verificados │   ├ ▪ SRV1 192.168.0.5       │
│                                  │   └ ◌ AP1                    │
│                                  │ ◆ R2  10.0.0.2 192.168.1.1   │
└──────────────────────────────────┴──────────────────────────────┘
```

## What it is

PacketSmith **does not implement an agent**. It wraps one you already have —
[Claude Code](https://claude.com/claude-code) today, Codex and OpenCode next — and gives it
a purpose-built interface for network labs.

The heavy lifting is done by
**[MCP-Packet-Tracer](https://github.com/Mats2208/MCP-Packet-Tracer)**, which is what
actually drives Packet Tracer. PacketSmith is the terminal experience on top of it.

**Why the topology is drawn instead of screenshotted:** a rendered tree works in every
terminal, shows state a bitmap cannot (IPs, links, port status), and can be navigated. The
real Packet Tracer capture stays available through `pt_screenshot`.

## Status: alpha

Working today: the streaming engine, the split-screen TUI, and the topology tree built from
live tool results. Not there yet: Codex/OpenCode adapters, multi-session, packaging.

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- Cisco Packet Tracer with the [MCP-Packet-Tracer](https://github.com/Mats2208/MCP-Packet-Tracer) extension
- `claude` CLI, authenticated

## Run

```bash
bun install
bun run src/index.tsx
```

> **One MCP client at a time.** The Packet Tracer MCP binds `127.0.0.1:54321` and only one
> process can hold it. If Claude Code, Cursor or Claude Desktop is running with that MCP
> configured, close it first — otherwise every `pt_*` call answers *"no está conectado"*.

### The plan-usage meter

The status bar can show how much of your Claude plan you have burned (`5H ███████░ 84%`).
That number is not in the CLI's output — it comes from Anthropic's own usage endpoint, which
needs the OAuth token the `claude` CLI already stored when you logged in.

So on first run PacketSmith reads it: from `~/.claude/.credentials.json`, or from the macOS
Keychain, where macOS will ask your permission. **Say no and nothing breaks** — you keep the
window's countdown (`5H ✓ 1h30`), which comes from the stream and costs nothing.

The token is sent to `api.anthropic.com` and nowhere else. It is never stored, printed or
logged. To skip the lookup entirely:

```bash
PACKETSMITH_NO_QUOTA=1 bun run src/index.tsx
```

## This or the MCP?

|  | [MCP-Packet-Tracer](https://github.com/Mats2208/MCP-Packet-Tracer) | PacketSmith |
|---|---|---|
| How you use it | inside Claude Code, Cursor, Claude Desktop | its own terminal app |
| MCP setup required | yes | no |
| Interface | whatever your client gives you | split-screen with live topology |
| Pick your engine | no | Claude *(Codex / OpenCode coming)* |
| Best for | you already use an MCP client | you want something that just runs |

**PacketSmith uses the MCP under the hood — it does not replace it.** If you already live in
Claude Code, the MCP alone is all you need.

## How it works

```
PacketSmith ──spawn──> claude --output-format stream-json
                          │  (NDJSON, event by event)
                          ├──> left panel:  text + tool calls
                          └──> right panel: pt_* results → topology
                                 │
                          claude ──stdio──> MCP-Packet-Tracer ──> Packet Tracer
```

Every engine translates its own output into a single `AgentEvent` union, so the UI never
knows which one is running. Adding an engine is one file plus one line —
see [AGENTS.md](AGENTS.md).

## License

MIT © [Mats2208](https://github.com/Mats2208)
