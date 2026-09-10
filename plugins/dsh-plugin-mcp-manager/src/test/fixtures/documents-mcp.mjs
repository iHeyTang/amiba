// A deterministic MCP stdio peer. Never contacts an external service.
import { createInterface } from "node:readline";

createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  switch (message.method) {
    case "initialize":
      result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture-documents", version: "1" } };
      break;
    case "ping": result = {}; break;
    case "tools/list":
      result = { tools: ["read", "write"].map(name => ({ name, description: `${name} fixture account`, inputSchema: { type: "object", properties: {} } })) };
      break;
    case "tools/call":
      result = { content: [{ type: "text", text: JSON.stringify({ account: process.env.FIXTURE_ACCOUNT, credential: process.env.FIXTURE_CREDENTIAL, pid: process.pid }) }] };
      break;
    default:
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } }) + "\n");
      return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
});
