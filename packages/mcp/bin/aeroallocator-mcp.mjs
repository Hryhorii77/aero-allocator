#!/usr/bin/env node
import { serve, SERVER_INFO } from "../src/server.mjs";
import { TOOLS } from "../src/tools.mjs";

const arg = process.argv[2];
if (arg === "--version" || arg === "-v") {
  console.log(SERVER_INFO.version);
} else if (arg === "--help" || arg === "-h") {
  console.log(`aeroallocator-mcp ${SERVER_INFO.version}: a free, read-only MCP server over https://aeroallocator.app (stdio).

Add it to an MCP client, for example:
  { "mcpServers": { "aeroallocator": { "command": "npx", "args": ["-y", "aeroallocator-mcp"] } } }

Tools: ${TOOLS.map((t) => t.name).join(", ")}
Set AEROALLOCATOR_URL to read from another host. It never signs or sends anything and needs no key.`);
} else {
  await serve();
}
