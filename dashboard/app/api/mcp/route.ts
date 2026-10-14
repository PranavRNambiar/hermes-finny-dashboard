// Finny remote MCP server (Streamable HTTP). Connect it as:
//   Claude    → Settings → Connectors → Add custom connector → https://<host>/api/mcp
//   ChatGPT   → Settings → Apps → Developer mode → Create → https://<host>/api/mcp (OAuth)
//   Claude Code → the finny plugin in /claude-plugin, or `claude mcp add --transport http finny https://<host>/api/mcp`
// Every tool is read-only. Auth is OAuth 2.1 (see lib/finny/auth.ts).

import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { issuer, verifyAccessToken } from "@/lib/finny/auth";
import {
  findSubscriptions,
  fxRate,
  getTransaction,
  listCards,
  listIncoming,
  resolvePeriod,
  listCategoriesAndTags,
  listTransactions,
  overview,
  pendingSplits,
  spendingBreakdown,
} from "@/lib/finny/data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INSTRUCTIONS = `Finny holds Pranav's card transactions, parsed from bank alert emails (cards: wise, dbs, scapia, axis, ixigo, ocbc).
Rules:
- Spending amounts are always positive and are the OWNER'S SHARE: when a bill was split, "amount" excludes what friends owe ("total_amount" is the full charge, "split_with" how many people share it). Use amount for all spending analysis.
- Money received (salary, transfers in, refunds) is separate: use money_in, or cash_flow in spending_overview (income vs spend per currency). Own top-ups/transfers are not income. Currencies are SGD and INR and are NEVER summed together; report each currency separately. Use get_fx_rate only if the user asks for a combined figure, and say it is converted.
- Dates are calendar dates in Asia/Singapore (SGT).
- Start broad questions with spending_overview; use spending_breakdown for "by X" questions and list_transactions for specifics.
- Categories are fixed: Food & Drink, Transport, Shopping, Subscriptions, Health & Fitness, Travel, Utilities & Bills, Rent & Housing, Entertainment, Education, Gifts, Transfers & Misc, Exclusions.
- "Exclusions" holds big one-offs the owner chose to keep out of spending (e.g. tuition). Totals and breakdowns already leave them out; spending_overview reports them separately under "excluded". Only include them if asked.
- user_tag is a free-form label the owner sets (e.g. "date night"); category is set automatically.`;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const currency = z.enum(["SGD", "INR"]);
const filters = {
  from: date.optional().describe("Start date inclusive, YYYY-MM-DD (SGT)"),
  to: date.optional().describe("End date inclusive, YYYY-MM-DD (SGT)"),
  card: z.string().optional().describe("Card slug, e.g. wise, dbs, scapia, axis, ixigo"),
  currency: currency.optional(),
  category: z.string().optional().describe("Exact category name"),
  merchant: z.string().optional().describe("Case-insensitive merchant substring"),
  tag: z.string().optional().describe("User tag (case-insensitive exact match)"),
  min_amount: z.number().optional(),
  max_amount: z.number().optional(),
};
const period = z
  .enum(["today", "last_7_days", "this_week", "last_30_days", "this_month", "last_month", "this_quarter", "this_year", "all_time"])
  .default("this_month");

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }],
});
const READ = { readOnlyHint: true, openWorldHint: false, destructiveHint: false };

function registerTools(server: McpServer, iss: string) {
  server.registerTool(
    "spending_overview",
    {
      title: "Spending overview",
      description:
        "Totals per currency for a period, change vs the previous period of equal length, category and card split, top merchants, daily series, largest transactions and anomaly-flagged transactions.",
      inputSchema: { period },
      annotations: READ,
    },
    async ({ period }) => ok(await overview(period))
  );

  server.registerTool(
    "list_transactions",
    {
      title: "List transactions",
      description: "Filtered, paginated list of individual transactions. Newest first by default.",
      inputSchema: {
        ...filters,
        sort: z.enum(["date_desc", "date_asc", "amount_desc"]).default("date_desc"),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: READ,
    },
    async (args) => ok(await listTransactions(args))
  );

  server.registerTool(
    "spending_breakdown",
    {
      title: "Spending breakdown",
      description:
        "Aggregate spend grouped by category, merchant, card, tag, month, week (Monday start) or day, separately per currency. Combine with filters, e.g. group_by=month + category='Food & Drink' for a food trend.",
      inputSchema: {
        ...filters,
        group_by: z.enum(["category", "merchant", "card", "tag", "month", "week", "day"]),
        top: z.number().int().min(1).max(100).optional().describe("Keep only the top N groups (non-time groupings)"),
      },
      annotations: READ,
    },
    async (args) => ok(await spendingBreakdown(args))
  );

  server.registerTool(
    "money_in",
    {
      title: "Money in",
      description:
        "Money received in a period: salary, transfers from people, refunds, and own top-ups (own_transfer — not income). Per item with counterparty and kind, plus totals per currency and kind.",
      inputSchema: {
        period,
        kind: z.enum(["salary", "transfer", "refund", "own_transfer"]).optional(),
      },
      annotations: READ,
    },
    async ({ period, kind }) => {
      const range = resolvePeriod(period);
      const { incoming } = await listIncoming({ from: range.from, to: range.to, kind });
      const totals: Record<string, Record<string, number>> = {};
      for (const r of incoming) {
        totals[r.currency] ??= {};
        totals[r.currency][r.kind] = Math.round(((totals[r.currency][r.kind] ?? 0) + r.amount) * 100) / 100;
      }
      return ok({ period: range, totals_by_currency_and_kind: totals, items: incoming });
    }
  );

  server.registerTool(
    "pending_splits",
    {
      title: "Who owes me",
      description: "Unsettled bill splits: what each person owes the owner, per currency, with the underlying transactions.",
      inputSchema: {},
      annotations: READ,
    },
    async () => ok(await pendingSplits())
  );

  server.registerTool(
    "find_subscriptions",
    {
      title: "Find subscriptions",
      description: "Detect recurring charges: same merchant, stable amount (±15%), roughly monthly or quarterly cadence.",
      inputSchema: { lookback_days: z.number().int().min(60).max(730).default(120) },
      annotations: READ,
    },
    async ({ lookback_days }) => ok(await findSubscriptions(lookback_days))
  );

  server.registerTool(
    "list_cards_and_categories",
    {
      title: "Cards, categories and tags",
      description: "Tracked cards (with their currency) plus every category and user tag in use, with counts.",
      inputSchema: {},
      annotations: READ,
    },
    async () => ok({ cards: await listCards(), ...(await listCategoriesAndTags()) })
  );

  server.registerTool(
    "get_fx_rate",
    {
      title: "FX rate",
      description: "Latest ECB reference rate between SGD and INR. Only for when the user explicitly wants a combined total.",
      inputSchema: { from: currency.default("SGD"), to: currency.default("INR") },
      annotations: { ...READ, openWorldHint: true },
    },
    async ({ from, to }) => ok(await fxRate(from, to))
  );

  // search + fetch follow the shape ChatGPT's deep research and connectors expect.
  server.registerTool(
    "search",
    {
      title: "Search transactions",
      description: "Search transactions by merchant name. Returns ids usable with fetch.",
      inputSchema: { query: z.string().min(1) },
      annotations: READ,
    },
    async ({ query }) => {
      const { transactions } = await listTransactions({ merchant: query, limit: 50 });
      return ok({
        results: transactions.map((t) => ({
          id: t.id,
          title: `${t.txn_date} · ${t.merchant ?? "Unknown"} · ${t.currency} ${t.amount.toFixed(2)} (${t.card}, ${t.category})`,
          url: `${iss}/?txn=${encodeURIComponent(t.id)}`,
        })),
      });
    }
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch transaction",
      description: "Full details of one transaction by id, including any bill splits.",
      inputSchema: { id: z.string().min(1) },
      annotations: READ,
    },
    async ({ id }) => {
      const t = await getTransaction(id);
      if (!t) return { isError: true, content: [{ type: "text" as const, text: `No transaction ${id}` }] };
      return ok({
        id: t.id,
        title: `${t.merchant ?? "Unknown"} — ${t.currency} ${t.amount.toFixed(2)} on ${t.txn_date}`,
        text: JSON.stringify(t, null, 1),
        url: `${iss}/?txn=${encodeURIComponent(t.id)}`,
        metadata: { card: t.card, category: t.category, currency: t.currency },
      });
    }
  );
}

async function handle(req: Request): Promise<Response> {
  const iss = issuer(req);
  const mcp = createMcpHandler(
    (server) => registerTools(server, iss),
    { serverInfo: { name: "finny", version: "1.0.0" }, instructions: INSTRUCTIONS },
    { basePath: "/api", disableSse: true, maxDuration: 60 }
  );
  const authed = withMcpAuth(
    mcp,
    async (_req, token) => {
      const info = await verifyAccessToken(token, iss);
      return info ? { token: token!, clientId: info.clientId, scopes: info.scopes, expiresAt: info.expiresAt } : undefined;
    },
    // mcp-handler joins these as `${resourceUrl}${resourceMetadataPath}`.
    { required: true, resourceUrl: iss, resourceMetadataPath: "/.well-known/oauth-protected-resource/api/mcp" }
  );
  return authed(req);
}

export { handle as GET, handle as POST, handle as DELETE };
