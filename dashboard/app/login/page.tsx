export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { error?: string; next?: string } }) {
  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <form
        method="post"
        action="/api/auth/login"
        className="w-full max-w-sm bg-white rounded-3xl shadow-sm border border-gray-100 p-6"
      >
        <h1 className="text-lg font-semibold text-gray-900">Sign in to Finny</h1>
        <p className="text-sm text-gray-500 mt-1 mb-5">Enter the owner password.</p>
        {searchParams.error && <p className="text-sm text-red-600 mb-3">Wrong password.</p>}
        <input type="hidden" name="next" value={searchParams.next ?? "/"} />
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          autoFocus
          required
          placeholder="Password"
          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          className="mt-4 w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
