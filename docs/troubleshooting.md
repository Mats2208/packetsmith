---
description: Why pt_* tools answer that Packet Tracer is not connected, which process owns the bridge port, and the other failures that are not obvious.
---

# Troubleshooting

Every entry here was a real failure. Most of them were quiet, which is why they are worth
writing down.

## Every `pt_*` call says Packet Tracer is not connected

Something else owns the bridge port. The MCP binds `127.0.0.1:54321` and only one process
can hold it — and the port belongs to the **Python MCP**, not to Packet Tracer, so two
live servers fight over it.

If Claude Code, Cursor or Claude Desktop is running with the Packet Tracer MCP configured,
it already has the port. Close it and restart PacketSmith.

This is not a bug we can fix here; it is how the MCP's HTTP bridge works.

## The bridge is down and nothing else is running

Packet Tracer needs the extension loaded, per session: *Extensions ▸ MCP BUILDER*. The
panel says `BRIDGE DOWN` and the first-run screen tells you where the switch is.

## 401 from a provider whose key I just pasted

Almost always the **wrong plan**. Kimi Code keys (`sk-kimi-…`) work against
`api.kimi.com/coding`; Moonshot platform keys work against `api.moonshot.ai`. Each returns
401 against the other, and the message does not explain why.

`/debug` shows which plan and which base URL are in use. `/connect` lets you pick the other
one.

## The header showed the wrong model

Fixed, but worth knowing what it was: the model was saved **globally** instead of per
engine. Pick `sonnet` under Claude, switch to Kimi, restart — and the app asked Kimi for a
model called `sonnet`. `config.json` now stores `models: { claude: "…", kimi: "…" }`, and an
old config migrates to the engine it was saved under.

## The usage bar shows another provider's numbers

Also fixed. The meter was mounted once, so after switching engines it kept polling the old
one. It now follows the active engine and clears before asking, so a stale number cannot be
mistaken for a fresh one.

If the bar shows nothing at all, that plan simply does not publish a meter — `/usage` says
so explicitly rather than drawing an empty gauge.

## The session dies right after starting, on Windows

**This one is Windows-only, which is exactly why it survived so long.** On macOS and Linux
`claude` is a real executable and everything works as written.

On Windows, `npm i -g` does not put an executable on the `PATH` — it puts a `.cmd` shim
that forwards `%*`, and **cmd.exe cannot carry a newline inside an argument**: it truncates
the command line there and drops everything after it.

`--append-system-prompt` takes a multi-line value. While it sat in the middle of the
argument list, everything after it was silently lost:

| Flag | What its loss looked like |
|---|---|
| `--mcp-config` / `--strict-mcp-config` | all 11 of the user's MCP servers loaded — 315 tools, 219 of them foreign |
| `--model` | asked for `sonnet`, got the default |
| `--allowedTools` | no allowlist at all |

Nothing errored. Measured after the fix on Windows: `1 server / 96 tools / 0 foreign`,
against `11 / 315 / 219` before.

The fix is two rules: spawn the real executable rather than the shim, and put any argument
whose value can contain a newline **last**. `/debug` prints the binary and the arguments,
which is how this became visible at all.

## Typing does nothing after clicking the topology panel

Fixed — the scrollbox used to take focus. If you see it again, it is a regression:
`focusable={false}` on the panel is what keeps the text field's focus.

## `bun` is not optional

OpenTUI does not run on Node. `bun run dev`, not `node`.

## The interface is in one language and the agent answers in another

`/language` changes both. The language travels in the system prompt, so the session
relaunches on the same conversation when you switch — an English interface answering in
Spanish is in no language at all.

## Nothing is drawn below a certain point

If you are editing the UI: nothing placed **after** a `scrollbox` is ever drawn — the
scrollbox takes all the remaining height. The status bar goes above it, always. There are
five more traps like this in
[AGENTS.md](https://github.com/Mats2208/packetsmith/blob/main/AGENTS.md), each one measured,
and none of them visible to `tsc`.
