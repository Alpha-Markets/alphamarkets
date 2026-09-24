export { AlphaMarkets, type AlphaMarketsConfig, type AlphaMarketsClient } from "./client.js";
export {
  DeadlineExpiredError,
  InsufficientCollateralError,
  InsufficientMarginError,
  InvalidQuoteError,
  InvalidTriggerPriceError,
  LimitPriceNotReachedError,
  InvalidOraclePriceError,
  MarketPausedError,
  mapError,
  NotImplementedError,
  InsufficientPoolReservesError,
  NetOpenInterestLimitExceededError,
  OpenInterestLimitExceededError,
  OrderExpiredError,
  OrderNotOpenError,
  AlphaMarketsContractError,
  AlphaMarketsError,
  PositionLimitExceededError,
  QuoteAlreadyUsedError,
  QuoteExpiredError,
  SlippageExceededError,
  StaleOraclePriceError,
  TriggerPriceNotReachedError,
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
  OptionSeriesStats,
  OptionSeriesParams,
  OptionSide,
  OptionsNamespace,
  OptionsQuoteParams,
  OptionsQuoteResult,
  SurfaceExpiry,
  SurfacePoint,
  SurfaceQuery,
  SurfaceSide,
  VolatilitySurface,
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
  PlaceLimitOrderParams,
  PlaceTriggerOrderParams,
  ReducePerpPositionParams,
  Side,
} from "./perps.js";
export type {
  FundingPayment,
  HistoryEvent,
  PortfolioNamespace,
  PortfolioPositions,
  PortfolioSummary,
} from "./portfolio.js";
export type { OpenOrder, OrderStatus, TriggerKind, TriggerOrder } from "./orders.js";
export { triggerFiresBelow } from "./orders.js";
export type { VaultBalances, VaultNamespace } from "./vault.js";
export type { Erc20Namespace } from "./erc20.js";
export type { Candle, CandleInterval, OracleNamespace, PricePoint, PriceRange, PriceReading, PriceSet, PricesNamespace } from "./oracle.js";
export type { FundingNamespace, FundingInfo, FundingRatePoint } from "./funding.js";
export type { OpenInterest, OpenInterestPoint, OpenInterestRange, RiskNamespace, RiskInfo } from "./risk.js";
export type { FeeInfo, FeesNamespace } from "./fees.js";
export type { ExplorerNamespace } from "./explorer.js";
export type { MarketTick, StreamNamespace, SubscribeOptions, WebSocketConstructor } from "./stream.js";

export * from "@alphamarkets/types";
export {
  analyzeStrategy,
  buildStrategy,
  payoffAt,
  payoffCurve,
  STRATEGY_KINDS,
  strategyLegs,
} from "./strategies.js";
export type {
  Greeks,
  Leg,
  LegKind,
  LegSide,
  OptionQuote,
  QuoteLookup,
  StrategyAnalysis,
  StrategyKind,
  StrategyParams,
  StrategyStrikes,
} from "./strategies.js";
export {
  DEFAULT_SHOCKS_BPS,
  liquidationDistances,
  netPerpExposure,
  shockPrice,
  stressAt,
  stressPortfolio,
} from "./stress.js";
export type {
  PositionDistance,
  StressInput,
  StressOption,
  StressPerp,
  StressPerpResult,
  StressResult,
} from "./stress.js";
export type {
  FundingAnalytics,
  FundingRange,
  InstitutionalNamespace,
  ProtocolExposure,
  ReportRange,
  ReportRow,
  ReportTotals,
  RiskScenario,
  WalletReport,
  WalletRisk,
} from "./institutional.js";
export type {
  PerpBound,
  PrepareExecuteRfq,
  PreparedTx,
  PrepareLimitOrder,
  PrepareOpenPerp,
  PrepareOptionClose,
  PrepareOptionOpen,
  PrepareTriggerOrder,
  TradingNamespace,
} from "./trading.js";
export { hedgeActions, hedgeBook, optionBookDelta, perpUnits, planHedge } from "./hedging.js";
export type { HedgeAction, HedgePlan, HedgePlanInput, HedgePosition, OptionDeltaInput, PerpDeltaInput } from "./hedging.js";
export type { Subaccount, SubaccountsNamespace } from "./accounts.js";
export type { AccountHealth, CollateralAsset, CrossMarginNamespace } from "./crossmargin.js";
export { RFQ_DOMAIN_NAME, RFQ_DOMAIN_VERSION, rfqQuoteTypedData } from "./rfq.js";
export type { RfqNamespace, RfqParameters, RfqQuote, RfqQuoteInput } from "./rfq.js";
export { STRUCTURED_KINDS, STRUCTURED_SUMMARY } from "./structured.js";
export type { StructuredKind, StructuredNamespace, StructuredProduct, StructuredRequest } from "./structured.js";
