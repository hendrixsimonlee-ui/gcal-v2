import Image from "next/image";
import { SignOutButton } from "@/components/sign-out-button";

export function Header({
  userName,
  userImage,
}: {
  userName: string | null | undefined;
  userImage: string | null | undefined;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950">
      <span className="font-semibold text-zinc-900 dark:text-zinc-50">
        Dance Scheduler
      </span>
      <div className="flex items-center gap-3">
        {userImage ? (
          <Image
            src={userImage}
            alt={userName ?? "User"}
            width={28}
            height={28}
            className="rounded-full"
          />
        ) : (
          <div className="h-7 w-7 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        )}
        <span className="hidden text-sm text-zinc-700 sm:inline dark:text-zinc-300">
          {userName}
        </span>
        <SignOutButton />
      </div>
    </header>
  );
}
