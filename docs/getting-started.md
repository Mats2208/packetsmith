---
description: Install PacketSmith, connect a provider, and build your first Cisco Packet Tracer topology from a plain-language prompt.
---

# Getting started

## What you need

**[Bun](https://bun.sh) ≥ 1.3.** Not optional — OpenTUI does not run on Node.

**Cisco Packet Tracer**, running, with the MCP extension loaded.

**An agent.** Either an authenticated [`claude`](https://claude.com/claude-code) CLI, or a
plan from any provider in `/connect`. You do not need both.

## Install

**A compiled binary — nothing else needed.** It carries the Bun runtime inside, so this
works on a machine with no Bun, no Node and no npm.

```bash
# macOS, Linux, WSL
curl -fsSL https://raw.githubusercontent.com/Mats2208/packetsmith/main/scripts/install.sh | sh

# Windows PowerShell
irm https://raw.githubusercontent.com/Mats2208/packetsmith/main/scripts/install.ps1 | iex
```

**From npm**, if you would rather:

```bash
npm i -g packetsmith      # or: bun add -g packetsmith
```

That package has no code of its own — a small Node launcher plus one binary per platform as
optional dependencies, so npm downloads only the ~100 MB that matches your machine instead
of all seven.

**From source**, which is what you want if you are going to change it:

```bash
git clone https://github.com/Mats2208/packetsmith
cd packetsmith
bun install
bun run setup
bun run dev
```

Then, once, to install the Packet Tracer MCP:

```bash
packetsmith setup          # or, from source: bun run setup
```

`setup` asks before every step. It creates a Python environment under
`~/.packetsmith`, installs [MCP-Packet-Tracer](https://github.com/Mats2208/MCP-Packet-Tracer)
from source (it is not on PyPI), registers it with `claude mcp add --scope user`, and
downloads the `.pts` extension. Run it with `--dry-run` to see the plan without touching
anything.

**One step cannot be automated.** Packet Tracer only accepts an extension through its own
menu: *Extensions ▸ Scripting ▸ Configure PT Script Modules ▸ Add…*, then
*Extensions ▸ MCP BUILDER*. Setup prints the exact path to select.

## Connect a provider

Press <kbd>/</kbd> and pick `/connect`. It asks two questions, in this order:

1. **Who** answers — ~150 providers, with the ones you already connected on top.
2. **Which plan** — only when the provider has more than one. Kimi has two: the Code
   subscription and the metered Open Platform. They are different endpoints with different
   keys, and a key for one returns 401 against the other.

Then either paste a key or, for ChatGPT Plus/Pro, complete a device login: PacketSmith
shows a code, you enter it at `auth.openai.com/codex/device`, and it continues on its own.

Keys land in `~/.packetsmith/auth.json` with mode `0600`. They are never printed, never
logged, and never sent anywhere except that provider's own API. `/debug` says *whether*
there is a credential, never which.

Environment variables win over the file, which is what anyone exporting a variable to test
something expects. Each plan documents its own — `/connect` names them when one is missing.

## First build

```
3 routers with OSPF and a LAN on each
```

The right panel fills in from the `pt_*` tool results as they arrive. Nothing is polled and
nothing is faked: the panel is derived from what the agent actually ran.

Useful next asks:

```
read the topology and tell me what's wrong
segment it into VLANs by department
verify connectivity between PC1 and the server
```

## Where your choices are kept

`~/.packetsmith/config.json` — theme, language, effort, and the model **per engine**. The
last one matters: `opus` does not exist on Kimi, so one saved model shared across engines
would ask a provider for something it has never heard of.
