# Session features

A host-only DSH plugin for required, versioned, per-session plugin behavior.
It does not create presets or run another agent/session engine.

A session records `amiba/session-feature` events with its own session ID,
plugin ID and behavior version. The ID prevents a fork or subagent from
accidentally inheriting plugin ownership. DSH can read the ignorable event
without a custom persistence backend; Amiba requires its provider before
running that session.

Feature providers register synchronous scoped setup with
`ctx.amibaSessionFeatures.register`. Ordinary plugin creation installs during
`setup`; generic cold resume installs during DSH's synchronous `agent/created`
publication transaction. Errors propagate and roll publication back. Prompt
assembly and tool execution recheck availability. Provider removal cancels and
drains affected live agents; a replacement cannot change a running agent's
installed feature generation. The owner must dispose/resume the agent.

The foundation is composed in the core bundle (including headless). Do not
remove it while using sessions that depend on Amiba features. Persisted
transcripts remain user data when feature plugins are disabled.
