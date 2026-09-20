import type { ContractAddresses } from "@alphamarkets/config";
import type { Address, Hex } from "@alphamarkets/types";
import { rfqManagerAbi } from "./abis.js";
import { PRICE_DECIMALS, toBaseUnits, type Amount } from "./amounts.js";
import type { AlphaMarketsClient } from "./client.js";
import { NotImplementedError } from "./errors.js";
import { executeTx, type TxOptions } from "./transactions.js";
import { resolveMarketId, toInteger } from "./utils.js";

/// The EIP-712 shape `RFQManager` verifies (`packages/contracts/src/perps/RFQManager.sol`): the single
/// TypeScript definition, used by market makers to sign and by tests, so a drift from the contract
/// fails the Anvil integration test. Field order, type string and domain must match the contract.
export const RFQ_DOMAIN_NAME = "AlphaMarketsRFQ";
export const RFQ_DOMAIN_VERSION = "1";

const rfqTypes = {
  RFQQuote: [
    { name: "user", type: "address" },
    { name: "marketId", type: "bytes32" },
    { name: "isLong", type: "bool" },
    { name: "collateral", type: "uint256" },
    { name: "leverage", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "validUntil", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface RfqQuoteInput {
  chainId: number;
  /// The `RFQManager` address the quote is for: binding it stops replay on another deployment.
  rfqManager: Address;
  user: Address;
  marketId: Hex;
  isLong: boolean;
  /// Settlement-token base units.
  collateral: bigint;
  leverage: bigint;
  /// 18 decimals.
  price: bigint;
  validUntil: bigint;
  nonce: bigint;
}

/// Arguments for viem's `signTypedData` (a market maker) or `verifyTypedData` for an RFQ quote.
export function rfqQuoteTypedData(input: RfqQuoteInput) {
  return {
    domain: { name: RFQ_DOMAIN_NAME, version: RFQ_DOMAIN_VERSION, chainId: input.chainId, verifyingContract: input.rfqManager },
    types: rfqTypes,
    primaryType: "RFQQuote" as const,
    message: {
      user: input.user,
      marketId: input.marketId,
      isLong: input.isLong,
      collateral: input.collateral,
      leverage: input.leverage,
      price: input.price,
      validUntil: input.validUntil,
      nonce: input.nonce,
    },
  };
}

/// A maker's signed price for one user's position.
export interface RfqQuote {
  user: Address;
  /// Symbol, market label or bytes32 id.
  market: string;
  side: "LONG" | "SHORT";
  collateral: bigint;
  leverage: number | bigint;
  price: bigint;
  validUntil: bigint;
  nonce: bigint;
  signature: Hex;
}

export interface RfqParameters {
  /// Widest gap between a quoted price and the mark price, in basis points of the mark.
  maxDeviationBps: bigint;
  /// A trade of at least this notional is a block trade (0: block trades off).
  blockMinNotional: bigint;
  blockMaxNotional: bigint;
}

export interface RfqNamespace {
  /// True when the deployment has an `RFQManager`.
  supported(): boolean;
  parameters(): Promise<RfqParameters>;
  /// Opens the quoted position for the wallet at the quoted price. The wallet must be the quote's
  /// user. The quote must be signed by a maker, be unexpired, unused and within the price band.
  execute(quote: RfqQuote, tx?: TxOptions): Promise<{ hash: Hex; positionId: bigint }>;
  /// The typed data a market maker signs for a quote (`signTypedData`), with the chain and manager
  /// filled in.
  typedData(quote: Omit<RfqQuote, "signature">): ReturnType<typeof rfqQuoteTypedData>;
  /// A quote's price and margin as 18-decimal / decimal amounts, for callers that hold strings.
  amounts(collateral: Amount, price: Amount, settlementDecimals: number): { collateral: bigint; price: bigint };
}

export function createRfq(client: AlphaMarketsClient, addresses: ContractAddresses, chainId: number): RfqNamespace {
  function manager(method: string): Address {
    if (!addresses.rfqManager) throw new NotImplementedError(method, "this deployment has no RFQManager (it needs a deployment made after [1.3.0])");
    return addresses.rfqManager;
  }

  const toInput = (quote: Omit<RfqQuote, "signature">): RfqQuoteInput => ({
    chainId,
    rfqManager: manager("rfq.typedData"),
    user: quote.user,
    marketId: resolveMarketId(quote.market),
    isLong: quote.side === "LONG",
    collateral: quote.collateral,
    leverage: toInteger(quote.leverage, "leverage"),
    price: quote.price,
    validUntil: quote.validUntil,
    nonce: quote.nonce,
  });

  return {
    supported: () => Boolean(addresses.rfqManager),
    async parameters() {
      const address = manager("rfq.parameters");
      const [maxDeviationBps, blockMinNotional, blockMaxNotional] = await Promise.all([
        client.readContract({ address, abi: rfqManagerAbi, functionName: "maxDeviationBps" }),
        client.readContract({ address, abi: rfqManagerAbi, functionName: "blockMinNotional" }),
        client.readContract({ address, abi: rfqManagerAbi, functionName: "blockMaxNotional" }),
      ]);
      return { maxDeviationBps, blockMinNotional, blockMaxNotional };
    },
    async execute(quote, tx) {
      const address = manager("rfq.execute");
      const input = toInput(quote);
      const { hash, result } = await executeTx(
        client,
        () =>
          client.simulateContract({
            address,
            abi: rfqManagerAbi,
            functionName: "execute",
            args: [
              {
                user: input.user,
                marketId: input.marketId,
                isLong: input.isLong,
                collateral: input.collateral,
                leverage: input.leverage,
                price: input.price,
                validUntil: input.validUntil,
                nonce: input.nonce,
              },
              quote.signature,
            ],
          }),
        tx,
      );
      return { hash, positionId: result };
    },
    typedData: (quote) => rfqQuoteTypedData(toInput(quote)),
    amounts: (collateral, price, settlementDecimals) => ({
      collateral: toBaseUnits(collateral, settlementDecimals),
      price: toBaseUnits(price, PRICE_DECIMALS),
    }),
  };
}
