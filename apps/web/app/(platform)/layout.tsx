import type { ReactNode } from "react";
import { auth } from "../../auth";
import { ClientErrorListener } from "../../components/client-error-listener";
import { OperatorShell } from "../../components/operator-shell";
import { SiseraPrivyProvider } from "../../components/privy-provider";
import { SessionRenewal } from "../../components/session-renewal";
import { TickerTape } from "../../components/ticker-tape";
import { WalletProvisioner } from "../../components/wallet-provisioner";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  const localMode =
    process.env.NODE_ENV !== "production" && process.env.SISERA_LOCAL_OPERATOR_MODE === "true";
  // Markets are public; the account pages under (account) enforce sign-in themselves.
  const signedIn = Boolean(session) || localMode;
  const operator = session?.user?.name ?? (localMode ? "Local operator" : "Guest");
  return (
    <SiseraPrivyProvider appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID}>
      <SessionRenewal />
      <ClientErrorListener />
      {signedIn && <WalletProvisioner />}
      <OperatorShell
        operator={operator}
        localMode={localMode}
        signedIn={signedIn}
        ticker={
          <TickerTape
            identity={{ accessToken: session?.accessToken, localOperator: localMode }}
            compact
          />
        }
      >
        {children}
      </OperatorShell>
    </SiseraPrivyProvider>
  );
}
