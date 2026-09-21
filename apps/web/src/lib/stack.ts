export interface StackLink {
  label: string;
  href: string;
  external: boolean;
}

export interface StackLayer {
  name: string;
  /// One plain sentence: what this layer does for the layers above it.
  role: string;
  tech: string[];
  link?: StackLink;
}

/// What the copy needs from the environment. Passed in so the layers hold no chain ID, network
/// name or address of their own (the brief forbids hardcoding them).
export interface StackContext {
  chainName: string;
  chainId: number;
  explorerUrl?: string;
  vaultUrl?: string;
}

/// The stack from the top of the pyramid down: each layer stands on the one below it, and the
/// terminal reaches the chain only through them.
export function stackLayers(context: StackContext): StackLayer[] {
  return [
    {
      name: "Terminal",
      role: "The trading app: markets, option chain, perpetuals, portfolio and strategies.",
      tech: ["Next.js", "React", "Tailwind CSS", "wagmi", "viem", "TanStack Query", "TradingView charts", "Vercel"],
      link: { label: "Open the terminal", href: "/perpetuals", external: false },
    },
    {
      name: "API and SDK",
      role: "One REST and WebSocket API and one typed client sit between the terminal and everything below.",
      tech: ["Fastify", "REST", "WebSocket", "TypeScript SDK"],
    },
    {
      name: "Indexer and services",
      role: "Off-chain workers read the chain into a database, price options, keep testnet price feeds fresh and watch margin health.",
      tech: ["Indexer", "PostgreSQL", "Pricing", "Keeper", "Risk monitor", "Hedger", "Railway"],
    },
    {
      name: "Smart contracts",
      role: "The vault, perps engine, options engine, risk manager and oracle router hold collateral and settle every trade.",
      tech: ["Solidity", "Foundry", "OpenZeppelin"],
      link: context.vaultUrl ? { label: "View the vault on the explorer", href: context.vaultUrl, external: true } : undefined,
    },
    {
      name: "Robinhood Chain",
      role: "The EVM chain where every deposit, position and settlement is recorded and can be checked.",
      tech: [context.chainName, `Chain ID ${context.chainId}`, "EVM"],
      link: context.explorerUrl ? { label: "Open the explorer", href: context.explorerUrl, external: true } : undefined,
    },
  ];
}

/// One flat piece of the pyramid, in SVG units. Widths are full widths, centred on the axis.
export interface Slice {
  y0: number;
  y1: number;
  top: number;
  bottom: number;
}

/// A layer is a front face and, under the top one, the ledge: the layer's flat top, seen from
/// slightly above, which juts out past the base of the layer above.
export interface PyramidLayer {
  face: Slice;
  ledge?: Slice;
}

const FACE_HEIGHT = 1;
const LEDGE_HEIGHT = 0.16;
/// Half-width gained per unit of height, and the step each ledge juts out on each side.
const SLOPE = 0.5;
const STEP = 0.22;

/// Lays out a stepped pyramid of `count` layers in a `width` by `height` box, apex layer first.
/// Every slice starts where the one above ends, in height and in width, so nothing overlaps or
/// leaves a gap. The top layer is a triangle and the last layer's bottom is exactly `width` wide.
export function pyramidGeometry(count: number, width: number, height: number): PyramidLayer[] {
  const layers: PyramidLayer[] = [];
  let y = 0;
  let w = 0;
  for (let index = 0; index < count; index++) {
    let ledge: Slice | undefined;
    if (index > 0) {
      const bottom = w + 2 * SLOPE * LEDGE_HEIGHT + 2 * STEP;
      ledge = { y0: y, y1: y + LEDGE_HEIGHT, top: w, bottom };
      y += LEDGE_HEIGHT;
      w = bottom;
    }
    const face = { y0: y, y1: y + FACE_HEIGHT, top: w, bottom: w + 2 * SLOPE * FACE_HEIGHT };
    y += FACE_HEIGHT;
    w = face.bottom;
    layers.push({ face, ledge });
  }
  const sx = w > 0 ? width / w : 1;
  const sy = y > 0 ? height / y : 1;
  const scale = (slice: Slice): Slice => ({ y0: slice.y0 * sy, y1: slice.y1 * sy, top: slice.top * sx, bottom: slice.bottom * sx });
  return layers.map(({ face, ledge }) => ({ face: scale(face), ledge: ledge ? scale(ledge) : undefined }));
}
