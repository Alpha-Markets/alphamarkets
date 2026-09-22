import { env } from "@/lib/env";

/// The venue's own deployed contracts — shown so a trader can verify them directly on the block
/// explorer instead of taking custody and settlement on trust. Shared by the landing page's Smart
/// Contract cards and the footer's contracts list, so both read the same deployment.
export const CONTRACTS = [
  { label: "Market registry", address: env.addresses.marketRegistry },
  { label: "Vault", address: env.addresses.vault },
  { label: "Perps engine", address: env.addresses.perpsEngine },
  { label: "Options engine", address: env.addresses.optionsEngine },
];
