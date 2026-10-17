export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { error?: string; next?: string } }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <form method="post" action="/api/auth/login" className="w-full max-w-[400px]">
        <div className="text-[22px] font-extrabold tracking-tight text-mint">finny</div>
        <h1 className="display mt-3 text-[44px] leading-[1.02] tracking-[-0.035em]">Know where<br />every dollar<br />went.</h1>
        <p className="mt-4 text-[16px] font-medium text-ink-soft">Your card alerts, parsed and sorted.</p>
        <div className="eyebrow mb-2 mt-10">Owner password</div>
        {searchParams.error && <p className="mb-2 text-[13px] text-coral">Wrong password.</p>}
        <input type="hidden" name="next" value={searchParams.next ?? "/"} />
        <input type="password" name="password" autoComplete="current-password" autoFocus required
          className="h-14 w-full rounded-2xl border-[1.5px] border-transparent bg-surface px-4 text-[17px] text-ink outline-none focus:border-mint" />
        <button className="mt-3 h-14 w-full rounded-2xl bg-ink text-[16px] font-bold text-surface">Continue</button>
      </form>
    </div>
  );
}
