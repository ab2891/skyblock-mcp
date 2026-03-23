#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { setApiKey } from "./hypixel.js";
import { registerTools } from "./tools.js";

const API_KEY = process.env.HYPIXEL_API_KEY;
if (!API_KEY) {
  console.error("Error: HYPIXEL_API_KEY environment variable is required.");
  console.error("Get one at https://developer.hypixel.net/");
  process.exit(1);
}

setApiKey(API_KEY);

const server = new McpServer({
  name: "skyblock-mcp",
  version: "1.0.0",
});

registerTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
