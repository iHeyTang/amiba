> Historical design, superseded on 2026-09-08. The private provider plane and its DSH projection have been removed. See [the current native-API architecture](../README.md).

# @amiba/app-runtime/model-plane-dsh

Pure adapter from canonical Model Plane profiles to DSH `llm-deepseek` or `llm-pi-ai` settings. It maps enabled model rows, modalities, and per-model reasoning effort wire values without putting DSH fields into canonical provider state.

Unsupported `provider-native` profiles or DSH-incompatible reasoning levels fail projection explicitly; they remain valid for other Model Plane consumers.
