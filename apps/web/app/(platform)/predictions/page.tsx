import { StatusBadge } from "@sisera/ui";
import { Target } from "lucide-react";
import { auth } from "../../../auth";
import { EmptyState } from "../../../components/empty-state";
import { PageHeader } from "../../../components/page-header";
import { PredictionBrowser } from "../../../components/prediction-browser";
import { PredictionPaperAccount } from "../../../components/prediction-paper-account";
import { accountErrorMessage, getPredictionMarkets } from "../../../lib/api";

export const dynamic = "force-dynamic";

export default async function PredictionsPage() {
  const session = await auth();
  const result = await getPredictionMarkets({
    accessToken: session?.accessToken,
    localOperator: process.env.SISERA_LOCAL_OPERATOR_MODE === "true",
  }).then(
    (value) => ({ value, error: null as unknown }),
    (error: unknown) => ({ value: null, error }),
  );
  const markets = result.value ?? [];
  return (
    <div>
      <PageHeader
        eyebrow="Outcome markets"
        title="Prediction markets"
        description="Browse Jupiter outcome-market snapshots, inspect resolution rules, and test decisions in a paper account. Observed prices are not executable quotes or calibrated probabilities."
        actions={
          <StatusBadge tone={markets.length ? "positive" : "negative"}>
            {markets.length
              ? `${markets.length} snapshots`
              : result.error
                ? "Feed unavailable"
                : "No open markets"}
          </StatusBadge>
        }
      />
      <div className="p-4">
        <PredictionPaperAccount />
        {markets.length ? (
          <PredictionBrowser markets={markets} />
        ) : (
          <EmptyState
            icon={Target}
            title="Prediction-market feed unavailable"
            copy={
              result.error
                ? accountErrorMessage(result.error)
                : "Jupiter has not returned open markets with current prices and resolution rules."
            }
            code="PREDICTION_DATA_UNAVAILABLE"
          />
        )}
      </div>
    </div>
  );
}
