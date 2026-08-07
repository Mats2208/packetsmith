---
description: The 13 terminal themes in PacketSmith, the colour roles behind them, and the contrast ratios enforced as a test rather than promised.
---

# Themes and contrast

`/theme` switches palette live as you scroll, and reverts if you press Esc. Whatever you
pick is remembered in `~/.packetsmith/config.json`.

## Contrast is a test, not a promise

Every colour has a **role**, and each role declares the contrast ratio it must clear
against all three surfaces (`bg`, `panel`, `sunken`). `bun test` audits all 13 themes and
fails the build if one falls short.

| Role | What it draws | Minimum |
|---|---|---|
| `fg` | primary text | 10:1 |
| `dim` | secondary: device model, interface names, section titles, the `⏱` line | 5:1 |
| `faint` | tertiary: tree guides, shortcuts, hints | 3:1 |
| `wire` | links on the canvas plan — these are **data** | 3:1 |
| `alert` `warn` `live` `brand` | state and identity | 4.5:1 |
| `line` `shadow` | chrome only: borders, rules, the empty half of a gauge | 1.5:1, capped at 4.5 |

The cap on `line` is not a typo. A chrome colour that clears a *text* ratio stops reading
as chrome and starts competing with the content.

## Why this exists

The original palette was not short of themes — it had **one colour doing two jobs**. `rule`
sat at **1.38:1** against the background, which is fine for drawing a hairline and
illegible for text. It was used as text in 25 places: the device model, the interface
names, the `⏱` line — the whole point of which is explaining why a turn is slow — the
FABRIC/DEVICES titles, and every instruction on the first-run screen, which is the first
thing anyone reads.

Any new theme would have inherited the defect, so the work started by splitting the role,
not by adding palettes.

Measured before the fix, against `#0A0A0A`:

| | hex | ratio | |
|---|---|---|---|
| `fg` | `#EAEAEA` | 16.46:1 | fine |
| `alert` | `#E61919` | 4.26:1 | **below AA** — and it is the error colour |
| `dim` | `#6B6B6B` | 3.72:1 | borderline |
| `wire` | `#4E4E4E` | 2.38:1 | low — and the plan says links are data |
| `rule` | `#2A2A2A` | **1.38:1** | illegible |

## The palettes

Own family: `telemetry` (the house one), `amber`, `phosphor`, `ice`, `contrast`, `paper`
(light).

Adapted: `catppuccin`, `gruvbox`, `nord`, `tokyo-night`, `dracula`, `rose-pine`,
`solarized`.

**Adapted, not copied.** Hue and saturation are kept and lightness is pushed until the
role's minimum is met. Where that would have wrecked the colour, the background was
darkened instead; where even that fell short, the theme's own comment says so. A theme that
does not pass the contrast test does not ship.

## Writing your own

Themes are data in `src/tui/themes.ts`. Add one, run `bun test`, and the audit tells you
which role on which surface falls short and by how much — not "it looks fine".

Check it renders with `bun run preview`, which prints the interface in fixed states in
about a second, with no Packet Tracer and no tokens.

## Effects

`/effects` turns on CRT scanlines, vignette and a rolling bar. Off by default: it is
character, not legibility.
