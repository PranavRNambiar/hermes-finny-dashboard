import { botStatus, queueBotJob, setBotSetting } from "@/lib/finny/data";
import { json, preflight, withAuth } from "@/lib/finny/http";

export const dynamic = "force-dynamic";

// GET: switches + recent on-demand sends
export const GET = (req: Request) => withAuth(req, () => botStatus());

// PUT { key, enabled }: flip one switch ("bot" is the master)
export const PUT = (req: Request) =>
  withAuth(req, async () => {
    const b = await req.json().catch(() => ({}));
    try { return await setBotSetting(b.key, b.enabled === true); }
    catch (e) { return json({ error: (e as Error).message }, 400); }
  }, "finny.write");

// POST { kind }: send that message now
export const POST = (req: Request) =>
  withAuth(req, async () => {
    const b = await req.json().catch(() => ({}));
    try { return await queueBotJob(b.kind); }
    catch (e) { return json({ error: (e as Error).message }, 400); }
  }, "finny.write");

export const OPTIONS = preflight;
