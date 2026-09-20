# ALPHAMARKETS

**Tagline:** Derivatives for tokenized equities.

## 1. Overview

AlphaMarkets is an onchain derivatives venue for tokenized equities, built for Robinhood Chain.

The product has two primary trading verticals:

- Options
- Perpetual derivatives

AlphaMarkets should let users trade volatility, direction, leverage, and hedging strategies against tokenized equities from one institutional-style terminal.

Example markets:

- NVDA Options
- TSLA Options
- AAPL Options
- META Options
- HOOD Options
- NVDA-PERP
- TSLA-PERP
- AAPL-PERP
- META-PERP
- HOOD-PERP

Primary positioning:

> Derivatives for tokenized equities.

Secondary positioning:

> Trade options and perpetual derivatives on tokenized equities.

AlphaMarkets should feel like capital-markets infrastructure, not a generic DeFi DEX.

---

## 2. Brand Direction

Official brand:

**ALPHAMARKETS**

Institutional product name:

**AlphaMarkets**

Primary tagline:

**Derivatives for tokenized equities.**

Optional secondary lines:

- Options and perpetuals, onchain.
- Institutional derivatives infrastructure for tokenized markets.
- One venue for tokenized equity derivatives.
- Trade volatility, direction, and leverage onchain.

Visual direction:

- Institutional
- Minimal
- High information density
- Black / off-white
- Neutral gray
- Restrained green / red only for market state
- Financial-terminal aesthetic
- Precise typography
- No neon crypto visuals
- No unnecessary 3D or AI-style iconography

**Update (2026-09-21, owner):** the palette now follows the logo. Dark teal-tinted neutrals replace the warm charcoal, and one teal accent (the mark's bright teal) marks primary actions, the selected item, focus and the price line. Green and red are unchanged in meaning: market direction only. See `apps/web/src/app/globals.css`.

---

## 3. Core Product

AlphaMarkets has two trading engines:

1. Options Engine
2. Perpetual Derivatives Engine

Both share:

- Market Registry
- Oracle Router
- AlphaMarkets Vault
- Risk Engine
- Margin Engine
- Fee Manager
- Settlement Layer
- Indexer
- Portfolio System
- SDK / API

High-level architecture:

```text
                        ALPHAMARKETS

                             USER
                              |
                        ALPHAMARKETS TERMINAL
                              |
               --------------------------------
               |                              |
          OPTIONS ENGINE                PERPS ENGINE
               |                              |
               ----------- RISK ENGINE -------
                              |
                        ORACLE ROUTER
                              |
                         ALPHAMARKETS VAULT
                              |
                    SMART CONTRACT LAYER
                              |
                       ROBINHOOD CHAIN
                              |
                     INDEXER + DATA API
                              |
                         PORTFOLIO UI
```

---

## 4. Chain

Primary deployment target:

**Robinhood Chain**

All core contracts must be EVM-compatible.

Do not hardcode chain configuration into frontend logic.

Use environment configuration:

```env
NEXT_PUBLIC_CHAIN_ID=
NEXT_PUBLIC_RPC_URL=
NEXT_PUBLIC_EXPLORER_URL=

NEXT_PUBLIC_MARKET_REGISTRY=
NEXT_PUBLIC_ALPHAMARKETS_VAULT=
NEXT_PUBLIC_OPTIONS_ENGINE=
NEXT_PUBLIC_PERPS_ENGINE=
NEXT_PUBLIC_ORACLE_ROUTER=
NEXT_PUBLIC_RISK_MANAGER=
NEXT_PUBLIC_FEE_MANAGER=

NEXT_PUBLIC_COLLATERAL_TOKEN=
```

Architecture should support:

- Testnet
- Mainnet
- Future multi-chain deployment if needed

---

## 5. Tokenized Equity Layer

Every derivatives market must reference a tokenized equity underlying.

Example config:

```json
{
  "symbol": "NVDA",
  "name": "NVIDIA",
  "assetType": "TOKENIZED_EQUITY",
  "tokenAddress": "0x...",
  "oracleId": "NVDA/USD",
  "decimals": 18,
  "optionsEnabled": true,
  "perpsEnabled": true,
  "status": "ACTIVE"
}
```

Potential markets:

- NVDA
- TSLA
- AAPL
- META
- MSFT
- AMZN
- GOOGL
- COIN
- HOOD
- MSTR
- SPY
- QQQ

New markets must be addable through configuration rather than frontend redesign.

---

## 6. Smart Contract Architecture

Suggested structure:

```text
contracts/

core/
    AlphaMarketsVault.sol
    MarketRegistry.sol
    CollateralManager.sol
    FeeManager.sol

options/
    OptionsEngine.sol
    OptionMarket.sol
    OptionSettlement.sol
    OptionPositionManager.sol

perps/
    PerpsEngine.sol
    PerpPositionManager.sol
    FundingManager.sol
    LiquidationEngine.sol

oracle/
    OracleRouter.sol
    PriceValidator.sol

risk/
    RiskManager.sol
    MarginEngine.sol

interfaces/
    IOracle.sol
    IMarketRegistry.sol
    IAlphaMarketsVault.sol
    IOptionsEngine.sol
    IPerpsEngine.sol
```

Keep contracts modular.

Avoid a monolithic protocol contract.

If upgradeability is used, clearly separate:

- Proxy
- Implementation
- Upgrade authority

Every privileged action must emit an event.

---

## 7. AlphaMarkets Vault

`AlphaMarketsVault.sol` is the collateral and settlement layer.

Responsibilities:

- User collateral deposits
- User withdrawals
- Locked margin
- Available balance
- Realized PnL settlement
- Option premium accounting
- Option expiry settlement
- Perpetual PnL settlement
- Funding transfers
- Fee transfers

Suggested state:

```solidity
mapping(address user => mapping(address token => uint256 balance)) public balances;
mapping(address user => mapping(address token => uint256 lockedMargin)) public lockedMargin;
mapping(address token => bool supported) public supportedTokens;
```

MVP should use one stable settlement asset.

Multi-collateral can be added later.

---

## 8. Options Engine

MVP option types:

- European Call
- European Put
- Cash settled

User flow:

```text
Select underlying
    ↓
Select expiry
    ↓
Select strike
    ↓
CALL / PUT
    ↓
Select position size
    ↓
Receive quote
    ↓
Risk / collateral validation
    ↓
Execute
    ↓
Track position
    ↓
Close or settle at expiry
```

Option identifier:

```text
UNDERLYING-EXPIRY-STRIKE-TYPE
```

Examples:

```text
NVDA-25SEP26-190-C
TSLA-25SEP26-350-P
```

Required position data:

- Underlying
- Option type
- Strike
- Expiry
- Contracts
- Entry premium
- Mark premium
- Collateral
- Realized PnL
- Unrealized PnL
- Status

---

## 9. Options Settlement

MVP uses cash settlement.

Call intrinsic value:

```text
max(Settlement Price - Strike, 0)
```

Put intrinsic value:

```text
max(Strike - Settlement Price, 0)
```

Final payout:

```text
Intrinsic Value × Contract Size × Number of Contracts
```

No delivery of the underlying equity is required for MVP.

Settlement price must use validated oracle data and a defined expiry methodology.

---

## 10. Options Pricing

Expose:

- Premium
- Implied Volatility
- Delta
- Gamma
- Theta
- Vega
- Break-even
- Max loss
- Max profit where applicable

MVP option analytics may be calculated offchain.

Suggested endpoint:

```text
POST /api/options/quote
```

Input:

```json
{
  "underlying": "NVDA",
  "strike": 190,
  "expiry": "2026-09-25",
  "type": "CALL",
  "contracts": 10
}
```

Output:

```json
{
  "premium": 4.82,
  "iv": 0.412,
  "delta": 0.58,
  "gamma": 0.031,
  "theta": -0.14,
  "vega": 0.22,
  "breakEven": 194.82
}
```

Offchain analytics must never become the sole source of settlement truth.

---

## 11. Perpetual Derivatives Engine

AlphaMarkets perpetuals provide leveraged long / short exposure to tokenized equities.

Examples:

- NVDA-PERP
- TSLA-PERP
- AAPL-PERP
- META-PERP
- HOOD-PERP

Required actions:

- Open Long
- Open Short
- Increase position
- Reduce position
- Close position
- Liquidate eligible position

MVP leverage:

- 1x
- 2x
- 3x
- 5x
- 10x

Maximum leverage must be configurable per market.

Never hardcode leverage limits in the frontend.

---

## 12. Perpetual Position State

Track:

```text
Market
Side
Entry Price
Mark Price
Index Price
Position Size
Collateral
Leverage
Unrealized PnL
Realized PnL
Liquidation Price
Funding Accrued
Margin Ratio
```

Example:

```text
NVDA-PERP

Side: LONG
Entry: $185.40
Mark: $191.20
Collateral: $1,000
Leverage: 5x
Notional: $5,000
PnL: +$156.42
```

---

## 13. Margin Engine

MVP:

**Isolated Margin**

Future:

- Cross Margin
- Portfolio Margin

Required calculations:

- Initial Margin
- Maintenance Margin
- Available Margin
- Margin Ratio
- Unrealized PnL
- Liquidation Price

Example config:

```json
{
  "market": "NVDA-PERP",
  "maxLeverage": 10,
  "initialMarginRate": 0.10,
  "maintenanceMarginRate": 0.05,
  "maxPositionNotional": 500000,
  "openInterestCap": 5000000
}
```

---

## 14. Liquidation Engine

Liquidation flow:

```text
Oracle price update
    ↓
Mark price update
    ↓
Position revaluation
    ↓
Margin check
    ↓
Maintenance margin breached?
    ↓
YES
    ↓
Position becomes liquidatable
    ↓
Liquidation execution
    ↓
PnL + fees settled
```

Liquidation logic must be deterministic.

Frontend must never be the source of truth for liquidation eligibility.

---

## 15. Funding Engine

Perpetual markets require funding to keep perp price aligned with the underlying index.

Track:

- Current funding rate
- Next funding rate
- Funding interval
- Next funding timestamp
- Funding paid / received

UI example:

```text
Funding Rate
0.0082%

Next Funding
02:14:32
```

Funding interval must be configurable.

---

## 16. Oracle Architecture

Use an abstraction layer:

```solidity
interface IOracle {
    function getPrice(bytes32 asset)
        external
        view
        returns (
            uint256 price,
            uint256 timestamp
        );
}
```

`OracleRouter` responsibilities:

- Route asset price requests
- Normalize decimals
- Validate timestamps
- Support fallback oracle
- Reject stale prices
- Reject abnormal deviations
- Pause affected markets when necessary

Required safeguards:

- Maximum price age
- Deviation threshold
- Fallback source
- Emergency pause
- Per-market oracle configuration

---

## 17. Price Types

AlphaMarkets must distinguish:

### Index Price

Reference price for the tokenized equity underlying.

### Mark Price

Used for:

- Unrealized PnL
- Margin
- Liquidation
- Risk calculations

### Last Price

Most recent executed derivatives price.

### Settlement Price

Validated expiry price used for options settlement.

---

## 18. Market Registry

Suggested structure:

```solidity
struct MarketConfig {
    bytes32 marketId;
    address underlyingToken;
    bytes32 oracleId;
    bool optionsEnabled;
    bool perpsEnabled;
    uint256 maxLeverage;
    uint256 openInterestCap;
    bool active;
}
```

Frontend, SDK, and protocol should query the registry.

Do not maintain separate inconsistent market lists across services.

---

## 19. Risk Manager

Responsibilities:

- Maximum leverage
- Maximum position size
- Open interest caps
- Margin parameters
- Collateral rules
- Market status
- Oracle health
- Settlement controls

Risk configuration must be per market.

Example:

```text
NVDA
Max leverage: 10x
Open interest cap: $5M
Max position: $500K
Maintenance margin: 5%

TSLA
Max leverage: 5x
Open interest cap: $3M
Max position: $250K
Maintenance margin: 7.5%
```

---

## 20. Fees

Fee configuration must be modular.

Options:

- Opening fee
- Closing fee
- Exercise / settlement fee

Perpetuals:

- Maker fee
- Taker fee
- Funding
- Liquidation fee

Suggested config:

```solidity
struct FeeConfig {
    uint256 makerFee;
    uint256 takerFee;
    uint256 optionOpenFee;
    uint256 optionCloseFee;
    uint256 settlementFee;
    uint256 liquidationFee;
}
```

Do not hardcode fee percentages in UI code.

---

## 21. Protocol Token / Buyback Module

Token ticker remains configurable during the rebrand.

Do not hardcode `$CTDL` into the AlphaMarkets codebase.

Use:

```env
NEXT_PUBLIC_PROTOCOL_TOKEN_SYMBOL=
NEXT_PUBLIC_PROTOCOL_TOKEN_ADDRESS=
```

If AlphaMarkets keeps the previous deflationary model:

```text
Trading Activity
      ↓
Protocol Fees
      ↓
Fee Manager
      ↓
Buyback Module
      ↓
Protocol Token Buyback
```

Buyback percentage must be configurable.

This allows AlphaMarkets to change token ticker or tokenomics without rewriting the trading engine.

---

## 22. Frontend Navigation

Desktop:

```text
ALPHAMARKETS

MARKETS
OPTIONS
PERPETUALS
PORTFOLIO
ACTIVITY

[ CONNECT WALLET ]
```

---

## 23. Landing Page

Hero:

```text
ALPHAMARKETS

Derivatives for tokenized equities.

Trade options and perpetual derivatives
on tokenized markets.

[ Launch Terminal ]
[ Explore Markets ]
```

Secondary product blocks:

```text
OPTIONS
Trade volatility and defined-risk exposure.

PERPETUALS
Long or short tokenized equities with leverage.

ONCHAIN
Collateral, positions and settlement remain verifiable.
```

Keep the landing page concise.

The trading terminal should remain the main product focus.

---

## 24. Trading Terminal

Desktop-first.

Suggested layout:

```text
---------------------------------------------------------------
 ALPHAMARKETS      MARKETS      OPTIONS      PERPETUALS     WALLET
---------------------------------------------------------------
 MARKET LIST |                                               |
             |                 CHART                         |
 NVDA        |                                               |
 TSLA        |                                               |
 AAPL        |-----------------------------------------------|
 META        |       OPTION CHAIN / POSITIONS                |
 HOOD        |                                               |
             |                             ORDER PANEL        |
---------------------------------------------------------------
```

Design principles:

- High information density
- Minimal animation
- Clear hierarchy
- Fast market switching
- Professional financial terminal
- Tabular numerals
- No oversized cards

---

## 25. Options Terminal

Required components:

- Underlying selector
- Spot / index price
- Expiry selector
- Option chain
- Calls
- Puts
- Strike
- Bid
- Ask
- Mark
- IV
- Greeks
- Open interest
- Volume
- Order ticket

Example chain:

```text
CALLS                                      PUTS

BID    ASK    IV    DELTA   STRIKE   DELTA    BID    ASK    IV

4.60   4.82   42%   0.61      180    -0.39    2.10   2.30   44%
2.90   3.10   40%   0.48      185    -0.52    3.40   3.60   42%
1.70   1.90   39%   0.34      190    -0.66    5.20   5.50   41%
```

Calls left.

Strike center.

Puts right.

---

## 26. Options Order Ticket

Example:

```text
NVDA 25 SEP 190 CALL

BUY CALL

Premium / Contract
$4.82

Contracts
10

Estimated Cost
$4,820

Break Even
$194.82

Max Loss
$4,820

[ BUY CALL ]
```

Display material risk metrics before wallet signing.

---

## 27. Perpetual Terminal

Example:

```text
NVDA-PERP

Index
$184.42

Mark
$184.48

LONG | SHORT

Order Type
Market | Limit

Size
$5,000

Leverage
1x  2x  3x  5x  10x

Collateral
$1,000

Estimated Entry
$184.48

Liquidation
$151.82

Fee
$4.00

[ OPEN LONG ]
```

---

## 28. Portfolio

Portfolio summary:

```text
PORTFOLIO VALUE
$124,821.40

Available Collateral
$82,411

Locked Margin
$42,410

Unrealized PnL
+$4,812

Realized PnL
+$12,442
```

Tabs:

- All Positions
- Options
- Perpetuals
- Open Orders
- Funding
- History

---

## 29. Markets Page

Columns:

```text
ASSET
INDEX PRICE
24H
OPTIONS VOLUME
PERP VOLUME
OPEN INTEREST
FUNDING
IV
STATUS
```

Actions:

- Trade Options
- Trade Perps

---

## 30. Transaction UX

States:

```text
Preparing
Awaiting Wallet
Submitted
Confirming
Confirmed
Failed
```

Confirmed example:

```text
POSITION OPENED

NVDA-PERP
LONG
$5,000
5x

[ View Position ]
[ View Transaction ]
```

---

## 31. Indexer

Track contract events:

- Deposits
- Withdrawals
- Option positions
- Option settlement
- Perp positions
- Position changes
- Funding
- Liquidations
- Fees
- Market configuration updates

Do not rely on frontend RPC calls for historical analytics.

---

## 32. Repository Structure

Suggested monorepo:

```text
alphamarkets/

apps/
    web/

services/
    api/
    indexer/
    pricing/
    risk-monitor/

packages/
    contracts/
    sdk/
    ui/
    config/
    types/
```

Suggested stack:

Frontend:

- Next.js
- React
- TypeScript
- Tailwind CSS
- wagmi
- viem
- TanStack Query
- Zustand

Contracts:

- Solidity
- Foundry
- OpenZeppelin

Backend:

- TypeScript / Node.js
- PostgreSQL
- Redis if needed
- WebSocket market data

---

## 33. API

Suggested endpoints:

```text
GET /markets
GET /markets/:symbol

GET /options/:symbol/chain
GET /options/:symbol/expiries
POST /options/quote

GET /perps
GET /perps/:symbol
GET /perps/:symbol/funding

GET /prices/:symbol

GET /portfolio/:wallet
GET /positions/:wallet
GET /orders/:wallet
GET /history/:wallet
```

---

## 34. SDK

Create an SDK from the beginning.

Example:

```typescript
import { AlphaMarkets } from "@alphamarkets/sdk";

const alphaMarkets = new AlphaMarkets({
  chainId,
  transport
});

const markets = await alphaMarkets.markets.list();

const quote = await alphaMarkets.options.quote({
  underlying: "NVDA",
  strike: 190,
  expiry: "2026-09-25",
  type: "CALL",
  contracts: 10
});

await alphaMarkets.perps.openPosition({
  market: "NVDA-PERP",
  side: "LONG",
  collateral: 1000,
  leverage: 5
});
```

Future SDK users:

- AlphaMarkets frontend
- Trading bots
- Trading agents
- Market makers
- External integrators
- Institutional API users

---

## 35. Smart Contract Events

Required events:

```solidity
event CollateralDeposited(...);
event CollateralWithdrawn(...);

event OptionPositionOpened(...);
event OptionPositionClosed(...);
event OptionExercised(...);
event OptionSettled(...);

event PerpPositionOpened(...);
event PerpPositionUpdated(...);
event PerpPositionClosed(...);
event PositionLiquidated(...);

event FundingPaid(...);

event MarketAdded(...);
event MarketUpdated(...);

event ProtocolFeeCollected(...);
event BuybackExecuted(...);
```

Design events with the indexer in mind.

---

## 36. Security

Minimum safeguards:

- Reentrancy protection
- Access control
- Pausable markets
- Oracle freshness checks
- Oracle deviation checks
- Precision-safe accounting
- Slippage checks
- Deadline checks
- Position caps
- Open-interest caps
- Withdrawal validation
- Upgrade controls
- Emergency controls

Prefer custom errors:

```solidity
error MarketPaused();
error InvalidOraclePrice();
error StaleOraclePrice();
error InsufficientCollateral();
error InsufficientMargin();
error PositionLimitExceeded();
error OpenInterestLimitExceeded();
```

---

## 37. Admin / Governance

Initial admin architecture may use controlled roles.

Target architecture should support migration to:

- Multisig
- Timelock
- Governance

Privileged actions:

- Add market
- Pause market
- Change oracle
- Update risk parameters
- Change leverage caps
- Change open interest caps
- Change fee configuration
- Upgrade implementation

Every privileged change must be emitted onchain.

---

## 38. MVP Scope

### Priority 0

- Robinhood Chain integration
- Wallet connection
- AlphaMarketsVault
- MarketRegistry
- OracleRouter
- RiskManager
- OptionsEngine
- PerpsEngine
- MarginEngine
- LiquidationEngine
- FeeManager

### Priority 1

- Options terminal
- Perpetual terminal
- Portfolio
- Market page
- Indexer
- API
- Transaction history

### Priority 2

- Greeks
- Funding history
- Open interest analytics
- Advanced charts
- Limit orders
- SDK

---

## 39. Phase 2

Add:

- Limit orders
- Stop loss
- Take profit
- Cross margin
- Multiple collateral assets
- Advanced options Greeks
- Volatility surface
- Option strategy builder
- Advanced funding analytics
- Trading API
- Market maker API

---

## 40. Phase 3

Institutional layer:

- Portfolio margin
- Subaccounts
- RFQ
- Block trades
- Structured products
- Market maker connectivity
- Advanced risk API
- Institutional reporting
- Clearing infrastructure
- Automated hedging tools

---

## 41. Options Strategy Builder

Future strategies:

- Covered Call
- Protective Put
- Bull Call Spread
- Bear Put Spread
- Straddle
- Strangle
- Iron Condor

UI should calculate:

- Net premium
- Max profit
- Max loss
- Break-even
- Greeks
- Payoff at expiry

---

## 42. Analytics

Future analytics:

- Options volume
- Perp volume
- Open interest
- Put / Call ratio
- Implied volatility
- Historical volatility
- Volatility skew
- Funding history
- Liquidations
- Long / short exposure

---

## 43. Explorer Integration

Every onchain action must be verifiable.

Display:

- Transaction Hash
- Block
- Contract
- Wallet
- Position ID
- Market ID

CTA:

```text
View on Explorer
```

---

## 44. Documentation

Documentation sections:

```text
Introduction
Architecture
Tokenized Equities
Options
Perpetuals
Collateral
Margin
Liquidations
Funding
Oracle
Fees
Settlement
Contracts
SDK
API
Risk
Security
Deployments
```

Keep documentation technical.

---

## 45. UX Principles

AlphaMarkets should optimize for:

1. Execution clarity
2. Risk visibility
3. Market data density
4. Fast interaction
5. Onchain transparency

Before transaction signing, always display the values that materially affect the trade.

Options:

- Premium
- Contracts
- Strike
- Expiry
- Break-even
- Max loss
- Fees

Perpetuals:

- Side
- Size
- Leverage
- Entry
- Mark
- Liquidation price
- Margin
- Funding
- Fees

---

## 46. Rebrand Migration

Replace old Citadelle branding.

Rename:

```text
Citadelle → AlphaMarkets
Citadelle Options → AlphaMarkets
CitadelleVault → AlphaMarketsVault
@citadelle/sdk → @alphamarkets/sdk
Citadelle Terminal → AlphaMarkets Terminal
```

Update:

- Repository names
- Package names
- Environment variables
- Contract display labels
- Frontend copy
- Metadata
- README
- Documentation
- Social preview
- Logos
- Favicons
- Explorer labels where possible

Do not rename already-deployed immutable contracts unless redeploying.

For new deployments, use AlphaMarkets naming.

---

## 47. Final Product Definition

AlphaMarkets is not positioned as a tokenized-stock spot exchange.

It is the derivatives layer built on top of tokenized equities.

```text
TOKENIZED EQUITIES
        ↓
     ALPHAMARKETS
        ↓
--------------------------------
|                              |
OPTIONS                    PERPETUALS
|                              |
Volatility                 Direction
Hedging                    Leverage
Defined risk               Long / Short
--------------------------------
        ↓
RISK + PRICING + COLLATERAL
        ↓
ONCHAIN SETTLEMENT
        ↓
ROBINHOOD CHAIN
```

Official brand:

**ALPHAMARKETS**

Primary tagline:

**Derivatives for tokenized equities.**

Product statement:

**Trade options and perpetual derivatives on tokenized equities.**
