// The extension-API level THIS host implements. It equals the API_VERSION
// of the @hermes-x/extension-api the host ships, so re-export keeps them in
// lockstep automatically. Extensions built against a newer SDK declare a
// higher manifest.apiVersion and are gated off until the host catches up.
export { API_VERSION as HOST_API_VERSION } from "@hermes-x/extension-api"
