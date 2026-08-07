---
description: Every PacketSmith command behind the slash palette — engine, model, effort, theme, topology, export — and what each one changes without a restart.
---

# Commands

Press <kbd>/</kbd> on an empty prompt, or <kbd>Ctrl</kbd>+<kbd>P</kbd> at any time.

The text field **never loses focus**. While a dialog is open every key is handled by the
palette and marked as consumed, so there is no focus to take away and give back — which is
where this kind of thing usually breaks.

| Key | |
|---|---|
| <kbd>⇅</kbd> | move one option |
| <kbd>←→</kbd> | jump to the previous/next group |
| <kbd>PgUp</kbd> <kbd>PgDn</kbd> | a page at a time — `/engine` has ~150 entries |
| <kbd>Home</kbd> <kbd>End</kbd> | first, last |
| <kbd>Tab</kbd> | complete the filter to the highlighted option |
| <kbd>⏎</kbd> | pick |
| <kbd>Esc</kbd> | close, reverting anything a live preview changed |

Typing filters. The match is fuzzy but ranked, and the order matters: prefix first, then
substring, then skipped letters. Without that hierarchy, typing `mo` with `/model` and
`/move` in the list is a coin flip. Descriptions are searched too, at a lower weight — so
looking for `tema` finds `/theme` even with the interface in English.

## The list

It was a board once: every command visible at once, two rows, grouped by family. It looked
good and was annoying to use, because on a board <kbd>←→</kbd> means *the one next to it*
and <kbd>⇅</kbd> means *another family* — so moving between two options that read as
neighbours could cost a family jump and a jump back.

It is a list now. Four things keep it from being a plain one:

- a row per option **with its description**; comparing two used to mean moving back and
  forth, because only the highlighted one showed its description;
- a group header where the group changes, which keeps the grouping the board gave;
- a window with an `n/N` counter, so you can tell there is more below;
- the typed filter at the top and always visible, rather than tucked in a corner and only
  drawn once you had typed something.

## The commands

### Agent

| | |
|---|---|
| `/engine` | who answers — ~150 providers, grouped: connected first, then via CLI, then featured, then the rest |
| `/connect` | pick a provider and a plan, and connect it |
| `/model` | switch model without losing the conversation. Shows each model's context window and price, from models.dev |
| `/effort` | `low` `medium` `high` `xhigh` `max` |
| `/clear` | start over: clears the conversation and the panel |

`/model` and `/effort` are launch arguments, so they cannot change in place. On the CLI
engine the process relaunches on the same session id and the conversation survives —
verified: give haiku a fact, relaunch as sonnet, it still remembers. On the HTTP engines the
history was ours all along, so there is nothing to preserve.

### Appearance

| | |
|---|---|
| `/theme` | 13 palettes, previewed live as you scroll, reverted if you press Esc |
| `/effects` | CRT scanlines and vignette. Off by default: it is character, not legibility |
| `/language` | interface **and** reply language — the language travels in the system prompt too |

### Packet Tracer

| | |
|---|---|
| `/topology` | re-read the topology and refill the panel |
| `/bridge` | check the bridge |

Both are canned prompts to the agent. Everything else you ask for in plain language, which
is more natural than a command per tool — there are 61 of them.

### Utility

| | |
|---|---|
| `/usage` | how much of the plan is used up |
| `/mcp` | whether the Packet Tracer MCP is registered — local, does not spend a turn |
| `/debug` | engine, plan, protocol, session id, model, effort, whether a credential exists |
| `/copy` | last reply to the clipboard, via OSC 52 |
| `/export` | conversation and topology to a file |
| `/help` `/exit` | |

`/debug` and `/connect` report **whether** there is a credential, never which one.

## Adding a command

A command is data: a name, a category, and a `run` that receives a context.

```ts
{
  name: "app.thing",
  category: "utilidad",
  run(ctx) { ctx.decir("hello") },
}
```

One that needs you to choose something has no concept of arguments — its `run` opens
another dialog. That avoids inventing a "command with parameters" type that would then need
parsing, validation and completion.

`CommandCtx` is an interface, so commands are tested without mounting any UI.
