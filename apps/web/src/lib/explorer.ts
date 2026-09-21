/// The explorer page for a contract, or undefined when no explorer is configured.
export function explorerAddressUrl(base: string | undefined, address: string): string | undefined {
  return base ? `${base.replace(/\/+$/, "")}/address/${address}` : undefined;
}
