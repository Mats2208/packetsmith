---
name: A provider does not work
about: One of the ~150 providers fails to connect or answer
labels: provider
---

Seven providers are verified end to end; the rest come from the
[models.dev](https://models.dev) catalog and have not been run. If one of those fails,
this is the right place — it is expected, not a surprise, and the report is what fixes it.

**Which provider and which plan.** From `/engine` and `/connect`.


**What it did.** The error as it appeared, verbatim. Never paste your API key —
PacketSmith never prints it, and neither should you.


**`/debug` output.** `/debug`, then `/copy`, then paste:

```

```

**If you know it:** does that provider speak `/chat/completions`, `/v1/messages`, or
something else? A link to its API docs saves a round trip.
