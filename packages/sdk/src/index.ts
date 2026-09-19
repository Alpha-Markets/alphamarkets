export { Orionis, type OrionisConfig, type OrionisClient } from "./client.js";
export {
  DeadlineExpiredError,
  InsufficientCollateralError,
  InsufficientMarginError,
  InvalidQuoteError,
  InvalidOraclePriceError,
  MarketPausedError,
  mapError,
  NotImplementedError,
  OpenInterestLimitExceededError,
  OrionisContractError,
  OrionisError,
  PositionLimitExceededError,
  QuoteAlreadyUsedError,
  QuoteExpiredError,
  SlippageExceededError,
  StaleOraclePriceError,
  UserRejectedError,
} from "./errors.js";
export { resolveMarketId } from "./utils.js";
export { convertDecimals, fromBaseUnits, PRICE_DECIMALS, toBaseUnits, type Amount } from "./amounts.js";
export { executeTx, type TxEvent, type TxOptions, type TxResult, type TxStatus } from "./transactions.js";
export * as margin from "./math.js";
export {
  closeQuoteTypedData,
  openQuoteTypedData,
  type CloseQuoteInput,
  type OpenQuoteInput,
  type QuoteDomainInput,
} from "./quotes.js";

export type { MarketsNamespace, MarketStats } from "./markets.js";
export type {
  CloseOptionPositionParams,
  CloseQuote,
  OpenOptionPositionParams,
  OptionOpenPreview,
  OptionSeries,
  OptionSeriesParams,
  OptionSide,
  OptionsNamespace,
  OptionsQuoteParams,
  OptionsQuoteResult,
  SignedQuote,
} from "./options.js";
export { premiumForOrder } from "./options.js";
export type {
  ClosePerpPositionParams,
  IncreasePerpPositionParams,
  OpenPerpPositionParams,
  OrderType,
  PerpMarketInfo,
  PerpOpenPreview,
  PerpsNamespace,
  ReducePerpPositionParams,
  Side,
} from "./perps.js";
export type {
  FundingPayment,
  HistoryEvent,
  OpenOrder,
  PortfolioNamespace,
  PortfolioPositions,
  PortfolioSummary,
} from "./portfolio.js";
export type { VaultBalances, VaultNamespace } from "./vault.js";
export type { Erc20Namespace } from "./erc20.js";
export type { OracleNamespace, PricePoint, PriceRange, PriceReading, PriceSet, PricesNamespace } from "./oracle.js";
export type { FundingNamespace, FundingInfo } from "./funding.js";
export type { OpenInterest, RiskNamespace, RiskInfo } from "./risk.js";
export type { FeeInfo, FeesNamespace } from "./fees.js";
export type { ExplorerNamespace } from "./explorer.js";
export type { MarketTick, StreamNamespace, SubscribeOptions, WebSocketConstructor } from "./stream.js";

export * from "@orionis/types";
