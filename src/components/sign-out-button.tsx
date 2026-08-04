import { signOut } from "@/auth";

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/sign-in" });
      }}
    >
      <button
        type="submit"
        className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface-3 hover:text-ink"
      >
        Sign out
      </button>
    </form>
  );
}
