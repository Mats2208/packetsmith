---
description: The system prompt PacketSmith gives its agent — what the model is told about driving Packet Tracer, and what it is deliberately not told.
---

# The system prompt

One file, `src/engine/prompt.ts`, 53 lines. It is short on purpose: every line in it earned
its place by fixing something that was visibly wrong.

## It enters two different ways

| Engine | How | What that means |
|---|---|---|
| `claude` | `--append-system-prompt` | It is **appended** to Claude Code's own prompt, not swapped for it. Instructions about editing files and git are still in there, and we cannot remove them |
| Kimi, OpenAI, … | first `role: "system"` message | It **is** the whole prompt. Nothing else |

That difference is half the reason the HTTP engines exist. Driving the CLI, we are a guest
adding a paragraph to the end of somebody else's instructions. With our own loop the prompt
is ours, and not one word of it is about `git`.

## What it says

**That there is a panel to its right.** Without this the agent answers with the full
inventory in prose — device by device, IP by IP, restating what the panel already draws —
and then adds an ASCII diagram of the topology on top. Duplicated and worse.

**The shape of a reply.** The chat is ~70 columns: two or three sentences for normal work,
no `##` headings on short answers, tables only for verification results (pings, health
checks) where they actually help, code blocks only for CLI you are going to paste.

**One specific, expensive instruction:**

> Use `pt_export_topology`, not `pt_query_topology`. Both list devices, but only export
> carries the **links**, and without links the panel cannot draw the hierarchy: you get a
> flat list grouped by subnet instead of the router → switch → hosts tree.

That one was learned watching the panel go flat for no visible reason. It is not a
just-in-case line; it is the difference between a tree and a list.

**How to work.** Verify against the device, not against the plan — a tool returning OK does
not prove Packet Tracer did what you asked. If something fails, say so plainly with the
cause. Look before you build: `pt_bridge_status`, `pt_export_topology`.

**The language, explicitly.** Otherwise the agent replies in the language of its own
instructions regardless of what the interface is set to, and an English interface answering
in Spanish is in no language at all. `/language` changes both, and the session relaunches so
the new prompt takes effect.

## What it deliberately does not say

It does not ask for structured output. There is no `MODULE=…` envelope, no agreed block for
the sidebar, no "answer in this shape and then your prose". The panel is derived from tool
results — see [architecture](architecture.md#the-panel-is-derived-not-dictated) for why
that is a correctness decision and not a stylistic one.

It does not describe the 61 tools either. Those arrive from the MCP server with their JSON
Schema attached; restating them in the prompt would be a second copy to keep in sync, and
it would go stale the first time the MCP adds one.

## Changing it

Keep it short. A system prompt is charged on **every** request of every turn, and a long one
buys less than it costs: the models that follow instructions do not need the repetition, and
the models that drift will drift anyway.

The test to apply before adding a line: *did the agent actually do the wrong thing without
it?* Every line currently in there passes that test. Add one that does not and you are
paying tokens for a superstition.
