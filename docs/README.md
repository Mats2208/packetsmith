---
description: PacketSmith documentation — a terminal agent that builds Cisco Packet Tracer topologies from plain language. Install, commands, providers, themes and architecture.
---

# PacketSmith — documentation

Everything here is written against code that exists. When a number appears — a latency, a
token count, a contrast ratio — it was measured, and the page says how it was measured.

### Using it

| | |
|---|---|
| [Getting started](getting-started.md) | install, connect a provider, first build |
| [Commands](commands.md) | everything behind `/`, and how the palette works |
| [Providers and plans](providers.md) | the two-level catalog, the three wire protocols, usage meters, discovery |
| [Themes and contrast](themes.md) | roles, the contrast test, writing your own |
| [Troubleshooting](troubleshooting.md) | the failures that are not obvious |

### How it works

| | |
|---|---|
| [Architecture](architecture.md) | the two engine classes, the MCP, and why the panel is derived rather than dictated |
| [The system prompt](prompt.md) | what the agent is told, what it is deliberately not told |
| [Development](development.md) | tests, conventions, where to add things |

For instructions aimed at AI agents working on this repository, see
[AGENTS.md](https://github.com/Mats2208/packetsmith/blob/main/AGENTS.md) — it carries the
traps and the measurements, not the tutorials.

## The three ideas

**Nothing that changes is written down.** The MCP server is asked what it can do — its 61
tools arrive with their JSON Schema attached, and tool 62 shows up on its own. Model lists
come from models.dev. Providers are discovered from the same catalog. A list typed into
source is stale the week after you type it.

**A provider is not an endpoint.** Kimi is one provider with two plans — a coding
subscription and a metered API — with different URLs, protocols, prices and keys. Listing
them as two providers is the kind of small lie that makes you paste the wrong key and get a
401 that explains nothing.

**The panel shows what happened, not what was claimed.** It is derived from tool results,
so a device the model says it created but did not, does not appear.
