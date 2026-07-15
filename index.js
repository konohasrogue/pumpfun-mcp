// pump.fun MCP server (READ-ONLY)
//
// This exposes a few "look things up" tools for pump.fun. It does NOT place
// trades and does NOT touch any wallet keys. It only reads public data.
//
// IMPORTANT HONESTY NOTE:
// pump.fun does not publish an official, documented, stable API for third
// parties. The endpoints below were found by inspecting pump.fun's own
// website traffic (browser Network tab) — they are what the site itself
// calls internally, not an official contract. They can change or start
// blocking automated requests at any time without notice. If a tool call
// starts failing again later, that's most likely why — the fix is to find
// the new working endpoint the same way (ask me and I can help update this
// file again).
//
// get_trending_tokens uses the confirmed-working "movers" endpoint
// (advanced-indexer.pump.fun). It requires a session_id parameter that looks
// tied to a browser session — we generate a random one in the same shape,
// which works for read-only reference but may not be officially supported.
//
// get_token_info and search_tokens below are NOT yet confirmed against a
// real working endpoint (only the trending/movers one has been verified) —
// they may fail until we find and wire in their real addresses the same way.

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import crypto from "node:crypto";

const MOVERS_BASE_URL = "https://advanced-indexer.pump.fun/boards/movers";
// Old, currently-broken base kept only so get_token_info/search_tokens have
// something to attempt; treat their results as unverified.
const BASE_URL = "https://frontend-api.pump.fun";

function randomSessionId() {
  const rand = () => crypto.randomBytes(6).toString("hex");
  return `pump_session_${rand()}_${rand()}`;
}

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
        const sessionId = randomSessionId();
        const data = await fetchJson(
          `${MOVERS_BASE_URL}?tier=web&surface=WEB&platform=WEB&limit=${limit}&session_id=${sessionId}`
        );
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Could not fetch trending tokens. pump.fun's endpoint may have changed again. Raw error: ${err.message}`
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
