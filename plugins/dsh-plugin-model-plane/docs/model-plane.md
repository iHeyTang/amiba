> Historical design, superseded on 2026-09-08. The private provider plane and its DSH projection have been removed. See [the current native-API architecture](../README.md).

# @amiba/app-runtime/model-plane

Harness-independent provider/model/credential control plane. It owns canonical provider profiles, model capabilities, reasoning levels, product defaults, credential references, provider discovery, normalization, optimistic revisions, and projection failure reporting.

`ModelPlaneService` runs without DSH. Storage, a write-only credential vault, and optional execution projections are ports supplied by the host application. A provider may be valid canonical state even when a particular harness cannot execute it.
