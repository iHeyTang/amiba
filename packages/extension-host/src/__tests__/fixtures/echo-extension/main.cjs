/**
 * Minimal fixture extension used by the runner-controller smoke test.
 * Exposes a single IPC channel "echo" that returns whatever args it receives.
 */
"use strict"

exports.activate = function activate(host) {
  host.ipc.expose("echo", async (args) => args)
}

exports.deactivate = function deactivate() {
  // no-op
}
