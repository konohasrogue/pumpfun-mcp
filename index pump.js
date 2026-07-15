// pump.fun MCP server (READ-ONLY)
//
// This exposes a few "look things up" tools for pump.fun. It does NOT place
// trades and does NOT touch any wallet keys. It only reads public data.
//
// IMPORTANT HONESTY NOTE:
// pump.fun does not publish an official, documented, stable API for third
// parties. The endpoint below (frontend-api.pump.fun) is the same one their
// own website uses, and is commonly used by the community, but it is NOT an
// official contract — it can change or start blocking automated requests at
// any time without notice. If a tool call starts failing, that's most likely
// why, and the fix is to find the current working endpoint (ask me and I can
// help you update this file).

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const BASE_URL = "https://frontend-api.pump.fun";

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 (compatible; MCP-ReadOnly-Client/1.0)"
    }
  });
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) for ${url}`);
  }
  return res.json();
}

function buildServer() {
  const server = new McpServer({
    name: "pumpfun-readonly",
    version: "1.0.0"
  });

  server.registerTool(
    "get_trending_tokens",
    {
      title: "Get trending pump.fun tokens",
      description:
        "Read-only: returns a list of currently trending/recent tokens on pump.fun. No trading, no wallet access.",
      inputSchema: {
        limit: z.number().min(1).max(50).default(20).describe("How many tokens to return (max 50)")
      }
    },
    async ({ limit }) => {
      try {
        const data = await fetchJson(
          `${BASE_URL}/coins?offset=0&limit=${limit}&sort=market_cap&order=DESC&includeNsfw=false`
        );
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Could not fetch trending tokens. pump.fun's public endpoint may have changed. Raw error: ${err.message}`
            }
          ],
          isError: true
        };
      }
    }
  );

  server.registerTool(
    "get_token_info",
    {
      title: "Get pump.fun token info",
      description:
        "Read-only: returns details (name, price info, market cap, etc.) for one token given its mint address.",
      inputSchema: {
        mint: z.string().describe("The token's mint/contract address on pump.fun")
      }
    },
    async ({ mint }) => {
      try {
        const data = await fetchJson(`${BASE_URL}/coins/${encodeURIComponent(mint)}`);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Could not fetch token info for ${mint}. Raw error: ${err.message}`
            }
          ],
          isError: true
        };
      }
    }
  );

  server.registerTool(
    "search_tokens",
    {
      title: "Search pump.fun tokens by name",
      description: "Read-only: search pump.fun tokens by name or symbol keyword.",
      inputSchema: {
        query: z.string().describe("Name or symbol keyword to search for")
      }
    },
    async ({ query }) => {
      try {
        const data = await fetchJson(
          `${BASE_URL}/coins?offset=0&limit=25&sort=market_cap&order=DESC&searchTerm=${encodeURIComponent(query)}`
        );
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `Search failed for "${query}". Raw error: ${err.message}` }
          ],
          isError: true
        };
      }
    }
  );

  return server;
}

const app = express();
app.use(express.json());

// Stateless: a fresh server + transport per request, as recommended for
// simple remote deployments.
app.post("/mcp", async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null
      });
    }
  }
});

app.get("/mcp", (req, res) => {
  res.status(405).json({ error: "Method not allowed. This endpoint is POST-only for MCP clients." });
});

app.get("/", (req, res) => {
  res.send("pump.fun read-only MCP server is running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`pump.fun MCP server listening on port ${PORT}`);
});
