import art from "@/lib/logo-paths.json";
import { MORPH_STATES, statePaths, type LogoArt } from "@/lib/logo-morph";
import { LogoMotion } from "./LogoMotion";

const logo = art as unknown as LogoArt;
/// Room around the art, in art units, so a state that swells past the rest outline is not clipped.
const PAD = 50;
/// What is rendered on the server and what stays on screen without motion: the logo as supplied.
const REST_PATHS = statePaths(logo, MORPH_STATES[0]!);

export interface MorphingLogoProps {
  /// Sizes the mark. It scales to the width you give it and keeps its aspect ratio.
  className?: string;
  /// Accessible name. Without it the mark is treated as decoration and hidden from screen readers.
  title?: string;
  /// Seconds to move from one state to the next. The whole loop takes this times the number of states.
  secondsPerState?: number;
  /// Holds the mark at rest.
  paused?: boolean;
  /// Prefix for the gradient ids, so two logos on one page do not share them. Must be unique per instance.
  idPrefix?: string;
}

/// The AlphaMarkets logo, drawn as stacked vector layers, breathing between a few shapes of itself.
///
/// Every state is the same layers with the same points moved by a smooth warp (see `lib/logo-morph.ts`),
/// so GSAP's MorphSVG plugin can interpolate each layer cleanly from state to state, forever. Nothing
/// rotates or bounces, and there are no other effects: only the `d` attribute of the layers changes.
///
/// The server renders the logo at rest, so it is on screen with the first paint. `LogoMotion` then loads
/// GSAP, MorphSVG and the state data in a separate chunk and starts the loop; with reduced motion that
/// chunk is never loaded and the mark simply stays at rest. The loop pauses while the mark is off screen.
export function MorphingLogo({ className, title, secondsPerState = 1.7, paused = false, idPrefix = "logo" }: MorphingLogoProps) {
  return (
    <LogoMotion secondsPerState={secondsPerState} paused={paused}>
      <svg
        viewBox={`${-PAD} ${-PAD} ${logo.width + 2 * PAD} ${logo.height + 2 * PAD}`}
        className={className}
        role={title ? "img" : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        focusable="false"
      >
        {title ? <title>{title}</title> : null}
        <defs>
          {logo.layers.map((layer, index) =>
            layer.grad ? (
              <linearGradient key={index} id={`${idPrefix}-g${index}`} gradientUnits="userSpaceOnUse" x1={layer.grad[0]} y1={layer.grad[1]} x2={layer.grad[2]} y2={layer.grad[3]}>
                <stop offset="0" stopColor={layer.grad[4]} />
                <stop offset="1" stopColor={layer.grad[5]} />
              </linearGradient>
            ) : null,
          )}
        </defs>
        {logo.layers.map((layer, index) => (
          <path key={index} data-layer d={REST_PATHS[index]} fill={layer.grad ? `url(#${idPrefix}-g${index})` : layer.fill} fillRule="evenodd" />
        ))}
      </svg>
    </LogoMotion>
  );
}
