import type { ContractAddresses } from "@orionis/config";
import { OptionType, type Address, type Hex } from "@orionis/types";
import { optionMarketAbi, optionsEngineAbi, vaultAbi } from "./abis.js";
import { convertDecimals, fromBaseUnits, PRICE_DECIMALS, toBaseUnits, type Amount } from "./amounts.js";
import type { OrionisClient } from "./client.js";
import { NotImplementedError, OrionisError, type OrionisContractError } from "./errors.js";
import type { FeesNamespace } from "./fees.js";
import { feeFromBps } from "./math.js";
import type { MarketsNamespace } from "./markets.js";
import { collectRiskViolations } from "./risk.js";
import { executeTx, type TxOptions } from "./transactions.js";
import { defaultDeadline, resolveMarketId, toInteger, toUnixSeconds } from "./utils.js";

const WAD = 10n ** 18n;

export type OptionSide = "CALL" | "PUT";

export interface OptionSeriesParams {
  /// Underlying symbol ("NVDA") or bytes32 market id.
  underlying: string;
  type: OptionSide;
  /// Strike price: decimal string (`"190"`) or 18-decimal base-unit `bigint`.
  strike: Amount;
  /// Unix seconds, `Date`, or ISO date string ("2026-09-25").
  expiry: bigint | Date | string;
  contracts: number | bigint;
}

export type OptionsQuoteParams = OptionSeriesParams;

/// A premium the pricing service has signed for one user and one order (EIP-712, checked by
/// `OptionsEngine`). The contract only ever charges or pays a premium carried by one of these, so
/// the caller cannot pick the price. A quote is single-use and expires at `validUntil`.
export interface SignedQuote {
  /// Total premium for the whole order, settlement-token base units.
  premium: bigint;
  /// Unix seconds.
  validUntil: bigint;
  nonce: bigint;
  signature: Hex;
}

/// Response of `POST /v1/options/quote` (PROJECT_BRIEF.md Section 10). The analytics are
/// display-only floats and never the source of settlement truth; `authorization` is present only
/// when a `user` was supplied and the pricing service has a signing key.
export interface OptionsQuoteResult {
  premium: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  breakEven: number;
  spot: number;
  authorization?: SignedQuote;
}

/// Wire shape of `authorization` before bigints are restored.
interface RawSignedQuote {
  premium: string;
  validUntil: string;
  nonce: string;
  signature: Hex;
}

export interface OpenOptionPositionParams extends OptionSeriesParams {
  /// From `previewOpen({ ..., user })`. It fixes the premium; there is no separate premium or
  /// slippage argument because the chain accepts only the signed price.
  authorization: SignedQuote;
  deadline?: bigint | Date | string;
  tx?: TxOptions;
}

export interface CloseOptionPositionParams {
  /// From {@link OptionsNamespace.quoteClose}. It fixes the premium received.
  authorization: SignedQuote;
  deadline?: bigint | Date | string;
  tx?: TxOptions;
}

export interface CloseQuote {
  /// Total premium received for closing, settlement-token base units.
  premium: bigint;
  quote: OptionsQuoteResult;
  authorization: SignedQuote;
}

export interface OptionOpenPreview {
  marketId: Hex;
  type: OptionSide;
  /// 18-decimal fixed point.
  strike: bigint;
  expiry: bigint;
  contracts: bigint;
  /// Underlying units per contract, 18 decimals (OptionMarket).
  contractSize: bigint;
  quote: OptionsQuoteResult;
  /// Total premium for the order, settlement-token units.
  premium: bigint;
  /// Signed authorisation for `premium`, to pass to `openPosition`. Only present when `user` was
  /// given and the pricing service can sign.
  authorization?: SignedQuote;
  fee: bigint;
  feeBps: bigint;
  /// `premium + fee` — what must be available in the Vault.
  totalRequired: bigint;
  /// Underlying price at which the position breaks even at expiry, 18 decimals.
  breakEven: bigint;
  /// Buyer's worst case: the whole premium plus the fee, settlement-token units.
  maxLoss: bigint;
  /// `null` for calls (unbounded); for puts, the payout if the underlying goes to zero less
  /// what was paid, settlement-token units.
  maxProfit: bigint | null;
  availableBalance?: bigint;
  sufficientCollateral?: boolean;
  violations: OrionisContractError[];
}

export interface OptionSeries {
  seriesId: Hex;
  expiry: bigint;
  strike: bigint;
  optionType: OptionType;
}

export interface OptionsNamespace {
  /// Expiries with at least one opened series, from `services/indexer` via the API. Requires
  /// `apiUrl`. This contract design has no pre-listed strike matrix — see `services/api`.
  expiries(underlying: string): Promise<bigint[]>;
  chain(underlying: string, expiry?: bigint | Date | string): Promise<OptionSeries[]>;
  /// Premium/IV/Greeks come from `services/pricing`, reached through `services/api`'s
  /// `POST /v1/options/quote` — requires `apiUrl`. This SDK never computes analytics itself:
  /// offchain analytics must never become the source of settlement truth, so there is no
  /// client-side fallback pricing model.
  quote(params: OptionsQuoteParams & { user?: Address }): Promise<OptionsQuoteResult>;
  /// Underlying units per contract, 18 decimals (OptionMarket).
  contractSize(underlying: string): Promise<bigint>;
  /// A signed price for closing an open position, valid for a short time. Requires `apiUrl`.
  quoteClose(positionId: bigint, user: Address): Promise<CloseQuote>;
  /// Everything PROJECT_BRIEF.md Section 45 requires before signing an options order. Requires
  /// `apiUrl` (for the quote). Pass `user` to also check the Vault balance.
  previewOpen(params: OptionSeriesParams & { user?: Address }): Promise<OptionOpenPreview>;
  openPosition(params: OpenOptionPositionParams): Promise<{ hash: Hex; positionId: bigint }>;
  closePosition(positionId: bigint, params: CloseOptionPositionParams): Promise<Hex>;
  /// Settles every position in an expired series at the validated settlement price. European
  /// cash-settled options have no separate user "exercise" call — `OptionExercised` events are
  /// emitted per in-the-money position as part of this transaction.
  settle(underlying: string, expiry: bigint | Date | string, strike: Amount, type: OptionSide, tx?: TxOptions): Promise<Hex>;
}

export interface OptionsDeps {
  client: OrionisClient;
  addresses: ContractAddresses;
  decimals: (token: Address) => Promise<number>;
  markets: MarketsNamespace;
  fees: FeesNamespace;
  apiUrl?: string;
}

function optionTypeOf(type: OptionSide): OptionType {
  if (type !== "CALL" && type !== "PUT") throw new OrionisError(`Option type must be "CALL" or "PUT", received "${type}"`);
  return type === "CALL" ? OptionType.CALL : OptionType.PUT;
}

/// Total premium for an order from the pricing service's per-underlying-unit price: scale by the
/// contract size and count at 18 decimals, then narrow to the settlement token's decimals. Shared
/// by the pricing service (which signs this number) and previews (which display it) so the two
/// cannot disagree.
export function premiumForOrder(perUnit: number, contractSize: bigint, contracts: bigint, tokenDecimals: number): bigint {
  const perUnitFixed = toBaseUnits(perUnit.toFixed(8), PRICE_DECIMALS);
  return convertDecimals((perUnitFixed * contractSize * contracts) / WAD, PRICE_DECIMALS, tokenDecimals);
}

function parseAuthorization(raw: RawSignedQuote | undefined): SignedQuote | undefined {
  if (!raw) return undefined;
  return { premium: BigInt(raw.premium), validUntil: BigInt(raw.validUntil), nonce: BigInt(raw.nonce), signature: raw.signature };
}

export function createOptions(deps: OptionsDeps): OptionsNamespace {
  const { client, addresses, decimals, markets, fees, apiUrl } = deps;

  function requireApi(method: string): string {
    if (!apiUrl) {
      throw new NotImplementedError(
        method,
        "requires `apiUrl` in the Orionis constructor config, pointing at services/api",
      );
    }
    return apiUrl;
  }

  async function getJson<T>(method: string, path: string): Promise<T> {
    const response = await fetch(`${requireApi(method)}${path}`);
    if (!response.ok) throw new OrionisError(`${method}: services/api returned ${response.status}`);
    return (await response.json()) as T;
  }

  async function expiries(underlying: string) {
    const rows = await getJson<string[]>("options.expiries", `/v1/options/${underlying}/expiries`);
    return rows.map((row) => BigInt(row));
  }

  async function chain(underlying: string, expiry?: bigint | Date | string) {
    const query = expiry === undefined ? "" : `?expiry=${toUnixSeconds(expiry)}`;
    const rows = await getJson<
      Array<{ seriesId: Hex; expiry: string; strike: string; optionType: number }>
    >("options.chain", `/v1/options/${underlying}/chain${query}`);
    return rows.map((row) => ({
      seriesId: row.seriesId,
      expiry: BigInt(row.expiry),
      strike: BigInt(row.strike),
      optionType: row.optionType as OptionType,
    }));
  }

  async function postJson<T>(method: string, path: string, body: unknown): Promise<T> {
    const response = await fetch(`${requireApi(method)}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok) {
      throw new OrionisError(`${method}: services/api returned ${response.status}: ${JSON.stringify(json)}`);
    }
    return json as T;
  }

  async function quote(params: OptionsQuoteParams & { user?: Address }): Promise<OptionsQuoteResult> {
    requireApi("options.quote");
    const strike = toBaseUnits(params.strike, PRICE_DECIMALS);

    const raw = await postJson<Omit<OptionsQuoteResult, "authorization"> & { authorization?: RawSignedQuote }>(
      "options.quote",
      "/v1/options/quote",
      {
        underlying: params.underlying,
        // A plain decimal strike (PROJECT_BRIEF.md Section 10's example: "strike": 190), sent as an
        // exact string rather than a float so the strike the pricing service signs is bit-for-bit
        // the strike the transaction submits.
        strike: fromBaseUnits(strike, PRICE_DECIMALS),
        expiry: new Date(Number(toUnixSeconds(params.expiry)) * 1000).toISOString(),
        type: params.type,
        contracts: Number(toInteger(params.contracts, "contracts")),
        user: params.user,
      },
    );
    return { ...raw, authorization: parseAuthorization(raw.authorization) };
  }

  async function quoteClose(positionId: bigint, user: Address): Promise<CloseQuote> {
    const raw = await postJson<Omit<OptionsQuoteResult, "authorization"> & { authorization: RawSignedQuote }>(
      "options.quoteClose",
      "/v1/options/quote/close",
      { positionId: positionId.toString(), user },
    );
    const authorization = parseAuthorization(raw.authorization)!;
    return { premium: authorization.premium, quote: { ...raw, authorization }, authorization };
  }

  async function contractSizeOf(marketId: Hex): Promise<bigint> {
    return client.readContract({
      address: addresses.optionMarket,
      abi: optionMarketAbi,
      functionName: "getContractSize",
      args: [marketId],
    });
  }

  async function previewOpen(params: OptionSeriesParams & { user?: Address }): Promise<OptionOpenPreview> {
    const marketId = resolveMarketId(params.underlying);
    const strike = toBaseUnits(params.strike, PRICE_DECIMALS);
    const expiry = toUnixSeconds(params.expiry);
    const contracts = toInteger(params.contracts, "contracts");
    const isCall = params.type === "CALL";
    const tokenDecimals = await decimals(addresses.settlementToken);

    const [quoted, contractSize, feeInfo] = await Promise.all([
      quote(params),
      contractSizeOf(marketId),
      fees.get(marketId),
    ]);

    // The quote is per underlying unit. The total the chain will charge is the signed premium
    // when there is one; otherwise (no `user`, so nothing to sign) it is the same calculation the
    // pricing service would have signed, shown for display only.
    const premiumPerUnit = toBaseUnits(quoted.premium.toFixed(8), PRICE_DECIMALS);
    const premium =
      quoted.authorization?.premium ?? premiumForOrder(quoted.premium, contractSize, contracts, tokenDecimals);
    const fee = feeFromBps(premium, feeInfo.optionOpenFee);
    const totalRequired = premium + fee;

    const breakEven = isCall ? strike + premiumPerUnit : strike > premiumPerUnit ? strike - premiumPerUnit : 0n;
    const maxProfit = isCall
      ? null
      : convertDecimals(
          ((strike > premiumPerUnit ? strike - premiumPerUnit : 0n) * contractSize * contracts) / WAD,
          PRICE_DECIMALS,
          tokenDecimals,
        );

    // Same notional, in the same units, that OptionsEngine passes to RiskManager's size and
    // open-interest checks.
    const notional = ((contractSize * strike) / WAD) * contracts;
    const [violations, availableBalance] = await Promise.all([
      collectRiskViolations(client, addresses, markets, { marketId, isLong: isCall, notional, needs: "options" }),
      params.user
        ? client.readContract({
            address: addresses.vault,
            abi: vaultAbi,
            functionName: "availableBalance",
            args: [params.user, addresses.settlementToken],
          })
        : Promise.resolve(undefined),
    ]);

    return {
      marketId,
      type: params.type,
      strike,
      expiry,
      contracts,
      contractSize,
      quote: quoted,
      premium,
      authorization: quoted.authorization,
      fee,
      feeBps: feeInfo.optionOpenFee,
      totalRequired,
      breakEven,
      maxLoss: totalRequired,
      maxProfit,
      availableBalance,
      sufficientCollateral: availableBalance === undefined ? undefined : availableBalance >= totalRequired,
      violations,
    };
  }

  function toQuoteStruct(authorization: SignedQuote | undefined, method: string) {
    if (!authorization) {
      throw new OrionisError(
        `${method}: a signed quote is required — call options.previewOpen (or quoteClose) with a \`user\` and pass its authorization`,
      );
    }
    return { validUntil: authorization.validUntil, nonce: authorization.nonce, signature: authorization.signature };
  }

  async function openPosition(params: OpenOptionPositionParams) {
    const quoteStruct = toQuoteStruct(params.authorization, "options.openPosition");
    const args = {
      marketId: resolveMarketId(params.underlying),
      optionType: optionTypeOf(params.type),
      strike: toBaseUnits(params.strike, PRICE_DECIMALS),
      expiry: toUnixSeconds(params.expiry),
      contracts: toInteger(params.contracts, "contracts"),
      premium: params.authorization.premium,
      deadline: params.deadline === undefined ? defaultDeadline() : toUnixSeconds(params.deadline),
    };

    const { hash, result } = await executeTx(
      client,
      () =>
        client.simulateContract({
          address: addresses.optionsEngine,
          abi: optionsEngineAbi,
          functionName: "openPosition",
          args: [args, quoteStruct],
        }),
      params.tx,
    );
    return { hash, positionId: result };
  }

  async function closePosition(positionId: bigint, params: CloseOptionPositionParams) {
    const quoteStruct = toQuoteStruct(params.authorization, "options.closePosition");
    const deadline = params.deadline === undefined ? defaultDeadline() : toUnixSeconds(params.deadline);

    const { hash } = await executeTx(
      client,
      () =>
        client.simulateContract({
          address: addresses.optionsEngine,
          abi: optionsEngineAbi,
          functionName: "closePosition",
          args: [positionId, params.authorization.premium, deadline, quoteStruct],
        }),
      params.tx,
    );
    return hash;
  }

  async function settle(underlying: string, expiry: bigint | Date | string, strike: Amount, type: OptionSide, tx?: TxOptions) {
    const { hash } = await executeTx(
      client,
      () =>
        client.simulateContract({
          address: addresses.optionsEngine,
          abi: optionsEngineAbi,
          functionName: "settleExpired",
          args: [resolveMarketId(underlying), toUnixSeconds(expiry), toBaseUnits(strike, PRICE_DECIMALS), optionTypeOf(type)],
        }),
      tx,
    );
    return hash;
  }

  return {
    expiries,
    chain,
    quote,
    contractSize: (underlying) => contractSizeOf(resolveMarketId(underlying)),
    quoteClose,
    previewOpen,
    openPosition,
    closePosition,
    settle,
  };
}
