import type { PredictionPaperState } from "@sisera/db";
import Decimal from "decimal.js";

export class PredictionPaperRejection extends Error {}

export function settlePredictionPaperOrder(
  state: PredictionPaperState,
  order: {
    marketId: string;
    outcome: "yes" | "no";
    depositUsd: string;
    priceUsd: string;
    side?: "buy" | "sell";
  },
) {
  const deposit = new Decimal(order.depositUsd);
  const price = new Decimal(order.priceUsd);
  const cash = new Decimal(state.cashUsd);
  const side = order.side ?? "buy";

  if (!deposit.isFinite() || deposit.lt(5) || deposit.gt(500))
    throw new PredictionPaperRejection("Paper prediction orders must be $5–$500.");
  if (!price.isFinite() || price.lte(0) || price.gte(1))
    throw new PredictionPaperRejection("A current outcome price below $1 is required.");

  const key = `${order.marketId}:${order.outcome}`;
  const held = state.positions[key];

  if (side === "sell") {
    const heldContracts = new Decimal(held?.contracts ?? "0");
    if (heldContracts.lte(0)) {
      throw new PredictionPaperRejection("You do not hold any contracts of this outcome to sell.");
    }
    const targetContracts = deposit.div(price).toDecimalPlaces(6, Decimal.ROUND_DOWN);
    const contractsToSell = targetContracts.gt(heldContracts) ? heldContracts : targetContracts;
    if (contractsToSell.lte(0)) {
      throw new PredictionPaperRejection("Sell order quantity is too small.");
    }
    const grossProceeds = contractsToSell.mul(price);
    const fee = grossProceeds.mul("0.005").toDecimalPlaces(6, Decimal.ROUND_UP);
    const netProceeds = grossProceeds.minus(fee);
    const remainingContracts = heldContracts.minus(contractsToSell);
    const remainingCost = Decimal.max(0, new Decimal(held?.costUsd ?? "0").minus(grossProceeds));

    return {
      state: {
        cashUsd: cash.plus(netProceeds).toString(),
        positions: {
          ...state.positions,
          [key]: {
            contracts: remainingContracts.toString(),
            costUsd: remainingCost.toString(),
          },
        },
      },
      contracts: contractsToSell.toString(),
      feeUsd: fee.toString(),
    };
  }

  if (cash.lt(deposit)) throw new PredictionPaperRejection("Insufficient paper USDC balance.");
  const fee = deposit.mul("0.005").toDecimalPlaces(6, Decimal.ROUND_UP);
  const contracts = deposit.minus(fee).div(price).toDecimalPlaces(6, Decimal.ROUND_DOWN);
  if (contracts.lte(0)) throw new PredictionPaperRejection("Order is too small at this price.");

  return {
    state: {
      cashUsd: cash.minus(deposit).toString(),
      positions: {
        ...state.positions,
        [key]: {
          contracts: new Decimal(held?.contracts ?? "0").plus(contracts).toString(),
          costUsd: new Decimal(held?.costUsd ?? "0").plus(deposit).toString(),
        },
      },
    },
    contracts: contracts.toString(),
    feeUsd: fee.toString(),
  };
}
