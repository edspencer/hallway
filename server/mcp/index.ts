// `/mcp` on the daemon's own port (D8): MCP's Streamable HTTP transport, served by the official TypeScript SDK's
// stateless handler (one server instance per request, no sessions: the 2026-07-28 revision, with 2025-era clients
// served statelessly too). It sits behind the same loopback-only middleware as everything else (server/security.ts).
//
// Change notifications for the resources come from the daemon's event bus: a `subscriptions/listen` stream hears
// `notifications/resources/updated` for `hallway://state` on every change, and for `hallway://apps/<slug>` when that
// app changes.
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { Context } from 'hono';
import { STATE_URI, appUri, createMcpServer, type McpContext } from './tools.js';

export { createMcpServer } from './tools.js';

export interface McpEndpoint {
  /** The Hono handler for `/mcp`. */
  handle: (c: Context) => Promise<Response>;
  close: () => Promise<void>;
}

export function mcpEndpoint(ctx: McpContext): McpEndpoint {
  const handler = createMcpHandler(({ era }) => createMcpServer(ctx, era), {
    onerror: (e) => process.stderr.write(`hallway: [mcp] ${e.message}\n`),
  });
  // internal: an MCP client isn't a dashboard, so it mustn't speed the prober up (EventBus.size)
  const unsubscribe = ctx.bus.subscribe(
    (e) => {
      handler.notify.resourceUpdated(STATE_URI);
      if ('slug' in e && typeof e.slug === 'string') handler.notify.resourceUpdated(appUri(e.slug));
      if (e.type === 'apps') handler.notify.resourcesChanged();
    },
    { internal: true },
  );
  return {
    handle: (c) => handler.fetch(c.req.raw),
    close: async () => {
      unsubscribe();
      await handler.close();
    },
  };
}
