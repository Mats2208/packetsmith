# Development

```bash
bun test          # everything, in about seven seconds
bun run typecheck
bun run preview   # print the UI in fixed states — no agent, no Packet Tracer, no tokens
bun run shots     # regenerate the README screenshots from the source
bun run bench     # prove the event loop is not the bottleneck
bun run dev       # the real thing
```

## Typechecking proves almost nothing here

This app spawns processes, parses somebody else's text output, and renders to a character
grid. The interesting failures are invisible to `tsc`:

- a sibling `<text>` without `flexDirection: "row"` draws a three-line wordmark as one line;
- anything placed **after** a `scrollbox` is never drawn at all;
- a `"…"` placeholder stored as state wins a `||` against the real value;
- a device name with a space makes a device vanish *and* reattaches its ports to another;
- on Windows, a newline inside an argument truncates the command line and silently drops
  every flag after it.

Every one of those shipped at some point. All of them are covered now, and the tests that
cover them assert **rendered character frames**, not internal state.

## The three levels of test

**Pure.** Parsers, layout maths, contrast, translation between wire protocols. No mounting,
no network. `topology`, `map`, `ascii`, `providers`, `anthropic`, `config`, `theme`.

**Rendered.** Mount the app with `testRender`, drive it with `mockInput`, assert what is on
screen — including colours, because a gauge whose full and empty halves are the same tone
measures nothing. `picker`, `connect`, `cabecera`, `focus`, `tui`, `status`, `theme-live`.

**Against real output.** The Packet Tracer fixtures in `test/fixtures` are real exports, not
tidied ones. That distinction is the reason two silent bugs were found at all.

## Before you claim it works

A change to the engine is not done until you have watched real events arrive **while** the
agent is working, not after it finished. That distinction is the whole point of the project.

Say which engine you tested with. They do not behave the same, and the three wire protocols
fail in different places.

## Conventions

**Minimal functional code. No bloat.** Before adding anything, ask whether it earns its
weight. No abstractions with a single caller, no dependency for something twenty lines of
stdlib can do, no config nobody asked for, no defensive code for cases that cannot happen,
no comments that restate the code.

**Dead code is a bug.** If a UI element exists, something must render it. If a function
exists, something must call it.

**Comments explain why, and cite the measurement.** `// Medido contra PT 9.0, no supuesto.`
is worth more than a paragraph describing what the regex does.

**Three dependencies**, and that is the budget: `@opentui/core`, `@opentui/solid`,
`solid-js`. A fuzzy-search library for twenty commands did not make the cut; the twenty
lines that replaced it are in `picker.tsx`.

## Where to add things

| You want to | Go to |
|---|---|
| add a provider with plans, another protocol, or a usage meter | `src/engine/providers/catalog.ts` |
| add a provider that is just a metered OpenAI-compatible API | nowhere — if models.dev documents it, it is already there |
| add a command | `src/tui/commands.ts` plus its strings in `src/tui/i18n.ts` |
| add a theme | `src/tui/themes.ts`, then `bun test` tells you which role falls short and by how much |
| teach the panel a new `pt_*` tool | `src/topology/ingest.ts` |
| change what the agent knows | `src/engine/prompt.ts` — read [prompt.md](prompt.md) first |

## Before publishing

`bun pm pack`, install the tarball into an empty directory, and **run it**. That is not
ceremony: the published package was broken and nothing in the repo could have told you.

Bun does **not** read a `tsconfig.json` from inside `node_modules`, so the JSX configuration
that works perfectly in development did not reach the installed copy and every `.tsx` file
fell back to looking for React's runtime. The fix is a per-file
`/** @jsxImportSource @opentui/solid */` pragma, which travels with the source and works in
both places. Keep it on every `.tsx` file you add.

```bash
bun pm pack --destination /tmp/p
cd /tmp/p && mkdir prueba && cd prueba
echo '{"name":"x","private":true}' > package.json
bun add file:../packetsmith-*.tgz
bun ./node_modules/packetsmith/src/index.tsx --help
```

## Building binaries

```bash
bun run build            # the seven targets
bun run build --local    # just this platform, to test quickly
```

Three things about that script are load-bearing, and each one was a failure first:

**The Solid JSX plugin.** In development the JSX transform comes from a *preload* declared
in `bunfig.toml`, and preloads do not run when compiling. Without
`createSolidTransformPlugin()` the binary builds perfectly and then dies at the first
`<box>` with `Orphan text error` — so `--help` looks fine and the app is broken.

**`bun install --os="*" --cpu="*" @opentui/core`.** OpenTUI draws through a native library,
one per platform, and a normal install only fetches this machine's. Cross-compiling without
this fails with `Could not resolve "@opentui/core-linux-x64"`. The quotes matter: Bun's
shell expands a bare `*` as a glob.

**Cross-compile on Linux, not Windows.** From Windows, Bun cannot extract the other
platforms' runtimes (`Failed to extract executable for bun-linux-x64`). `--local` works
everywhere; the full set runs in CI on `ubuntu-latest`.

The release workflow typechecks and tests before building. A broken release is worse than a
late one.

## Publishing

Tagging `v*` builds the seven binaries and attaches them to the release. Publishing to npm
additionally needs a token, loaded once:

```bash
bash scripts/npm-token.sh          # macOS, Linux, Git Bash
.\scripts
pm-token.ps1            # Windows PowerShell
```

It asks for the token without echoing it and pipes it to `gh secret set` — a token passed
as an argument is visible in the process list, and `gh secret set` takes the **name** as the
argument and the **value** on stdin, so getting them the wrong way round leaves the token as
the secret's *name*. Secret names are not secret.

The npm job is gated on `PUBLISH_NPM == 'true'` so a missing token cannot leave a release
half-published, with binaries attached and npm untouched.

## Both platforms, every time

The project is developed on macOS **and** Windows. A change that only ever runs on one is
how the argv bug survived several releases. `bun test` covers the split with `resolveBin`'s
platform argument, so at minimum assert the other OS instead of assuming it.

## The traps

`AGENTS.md` at the repo root carries the full list — OpenTUI layout traps, input traps, the
Windows argv trap, the protocol traps — each with what you see when you hit it and the rule
that avoids it. Read it before touching `src/tui/`.
