import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      isAdmin: boolean;
      /** Can run the dues ledger without being an admin. See requireFinance
       * in src/lib/authz.ts for what that does and does not open up. */
      isFinanceAdmin: boolean;
    } & DefaultSession["user"];
  }
}
