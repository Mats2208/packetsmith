# Providers and plans

## A provider is not an endpoint

The catalog has two levels, and the difference is the whole point:

- a **provider** is who answers you — Kimi, OpenAI, Z.AI;
- a **plan** is the door you come in through and how you pay.

A plan carries its own base URL, wire protocol, model list, price, authentication method
and usage meter. Two plans of the same provider can share nothing but the company name.

This started as a bug. `kimi` and `moonshot` shipped as two separate providers, which is
wrong twice: they are one company, and their keys are not interchangeable — `sk-kimi-`
against `api.moonshot.ai` is a 401, and the error message tells you nothing about why.

| Provider | Plans |
|---|---|
| **Kimi · Moonshot AI** | `coding` — Kimi Code subscription, Anthropic protocol, has a usage meter<br>`api` — Open Platform, metered |
| **OpenAI** | `chatgpt` — Plus/Pro subscription, device login, Responses protocol, has a usage meter<br>`api` — Platform, metered |
| **Z.AI · GLM** | `coding` — GLM Coding Plan<br>`api` — Platform, metered |
| **DeepSeek** | `api` — metered, balance meter |
| **Groq** | `api` — metered |
| **OpenRouter** | `api` — credits, balance meter |

Plus roughly **145 more**, discovered rather than written down (below).

## The three wire protocols

They are not variants of one format. Picking the wrong one fails immediately; picking the
right one and getting a detail wrong fails on the *second* turn, after tools already ran.

| | OpenAI `/chat/completions` | Anthropic `/v1/messages` | Responses `/responses` |
|---|---|---|---|
| system prompt | a message | its own field | `instructions` |
| history | messages with roles | messages with roles | a flat list of items |
| tool declaration | `function.parameters` | `input_schema` | flat `{type,name,parameters}` |
| streaming | deltas on `choices` | typed block events | named events |
| usage | needs `stream_options.include_usage` | `message_start`/`message_delta` | `response.completed` |

Subscription coding plans expose whatever surface their vendor's own CLI uses. Metered APIs
expose the OpenAI one.

### The four traps

**Tool arguments do not arrive whole** (OpenAI). They are split across many deltas.
Accumulate by **index** — not by id, which is missing from the middle deltas — as raw text,
and parse only at close. Parsing early blows up on half a JSON object.

**Tool results go in one message** (Anthropic). Sent one message per result, the next
request is rejected.

**Thinking blocks must come back verbatim, with their signature** (Anthropic + extended
thinking). Rebuilding the assistant message from text plus tool calls gives a 400. Kimi K3
thinks by default, so this is every turn, not an edge case.

**Reasoning items must be echoed with their `encrypted_content`** (Responses with
`store: false`). Same shape, different name. We do not leave the conversation on anyone's
server, so the request asks for `include: ["reasoning.encrypted_content"]` and gives the
items back untouched.

The last three only break on the second loop iteration. `test/anthropic.test.ts` and
`test/providers.test.ts` build that second-iteration history by hand so the failure shows
up without a live API and without spending a token.

## Usage meters

With the `claude` CLI, plan usage came from an Anthropic endpoint. With our own providers
nothing arrived — and on a **subscription** that is worse than on a metered API, because
there is no per-token price to count. The bar read `$0.0000` all session and nothing told
you how much was left until a turn got cut off.

Each plan declares where its number comes from, and the shapes differ wildly — percentages,
dollar balances, absolute quotas. They are normalized into the one the status bar already
knew how to draw.

Verified live, Kimi Code:

```
GET https://api.kimi.com/coding/v1/usages
→ { usage: {limit:"100", used:"23", resetTime:…},
    limits: [{ window:{duration:300,timeUnit:"TIME_UNIT_MINUTE"}, detail:{used:"13"} }] }
```

which the bar renders as `5H ██░░░░ 13%   7D 23%`. The window label is **the provider's**,
computed from the duration it reports — writing `5H` for everyone would be inventing a
number that is already published.

`/usage` prints the same thing with the reset time and any extra note.

If the endpoint does not answer, the meter turns off and the app carries on. A meter is
information, not a dependency.

## Discovery: the other ~145

`todosLosProveedores()` returns the curated six plus every provider
[models.dev](https://models.dev) documents that clears four bars:

- an **HTTPS base URL** — otherwise there is nowhere to talk to;
- **documented env vars** — otherwise there is nowhere for a key to come from;
- at least one model with **`tool_call: true`** — a model that cannot call tools cannot
  drive Packet Tracer, and offering it fails on the first turn;
- an SDK whose **protocol we actually speak**. This is a whitelist, not a blacklist: a
  provider on `@ai-sdk/amazon-bedrock` speaks something this repo does not implement.

Curated entries win by id, and they are the only place a plan, a protocol override or a
usage meter can be declared. Everything else gets one metered plan, which is enough.

## Model lists

A model list written into source is stale the week after you write it. This repo offered
`glm-4.6` while Z.AI was shipping `glm-5.2`, and nothing failed loudly — it just quietly
offered something worse than what was available.

So the list is fetched: models.dev, cached at `~/.packetsmith/models.json`, refreshed in the
background when the copy is over 12 hours old, written to a temp file and renamed so a
process that dies mid-download leaves the old copy intact rather than truncated JSON. The
list in the catalog is the offline fallback and nothing more.

The same data feeds `/model`'s descriptions (context window, price, whether it reasons) and
calibrates the context gauge per model rather than per provider.

## Adding a provider

If models.dev already knows it and it clears the four bars above, it is already there.

If it needs a plan, another protocol, or a usage meter, add it to `PROVIDERS` in
`src/engine/providers/catalog.ts`. That is the only hand-written list, and it is
hand-written precisely because those three things cannot be discovered.
