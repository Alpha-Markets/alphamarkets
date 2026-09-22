"use client";

import { chains } from "@alphamarkets/config";
import { chip, cn, rowLink } from "@alphamarkets/ui";
import Link from "next/link";
import { useMemo, useState } from "react";
import { env } from "@/lib/env";
import { explorerAddressUrl } from "@/lib/explorer";
import { MONO } from "@/lib/frame";
import { pyramidGeometry, stackLayers, type Slice } from "@/lib/stack";
import { ArrowIcon } from "./ArrowIcon";

const WIDTH = 600;
const HEIGHT = 480;
/// How far the layers above the selected one rise, opening the stack to show the selected layer's top.
const LIFT = 24;
/// Room under the base for its shadow.
const SHADOW = 24;
const CENTRE = WIDTH / 2;
const LABEL_SIZE = 18;

const outline = (slice: Slice) =>
  `${CENTRE - slice.top / 2},${slice.y0} ${CENTRE + slice.top / 2},${slice.y0} ${CENTRE + slice.bottom / 2},${slice.y1} ${CENTRE - slice.bottom / 2},${slice.y1}`;
const leftHalf = (slice: Slice) => `${CENTRE - slice.top / 2},${slice.y0} ${CENTRE},${slice.y0} ${CENTRE},${slice.y1} ${CENTRE - slice.bottom / 2},${slice.y1}`;

/// The layer's colour: the mark's teal at the top of the pyramid, deepening to the ink at its base.
/// The curve keeps every layer at 4.5:1 or better against its lettering.
const shade = (index: number, count: number) => `color-mix(in oklab, var(--color-ink) ${((index / (count - 1)) ** 0.9) * 100}%, var(--color-mark))`;

/// The two brightest layers take ink lettering; the rest take paper.
const labelFill = (index: number) => (index <= 1 ? "var(--color-ink)" : "#f7faf9");

/// The tech stack as a stepped pyramid the reader opens layer by layer: pick one and the layers above
/// it rise to show its top, while the panel names what it is made of. The five buttons are the
/// accessible control; the pyramid itself answers the same clicks. Nothing moves until the reader does.
export function StackPyramid() {
  const layers = useMemo(
    () =>
      stackLayers({
        chainName: chains[env.chainId].name,
        chainId: env.chainId,
        explorerUrl: env.explorerUrl,
        vaultUrl: env.addresses.vault ? explorerAddressUrl(env.explorerUrl, env.addresses.vault) : undefined,
      }),
    [],
  );
  const geometry = useMemo(() => pyramidGeometry(layers.length, WIDTH, HEIGHT), [layers.length]);
  // The base is the foundation, so it is where the pyramid opens.
  const [selected, setSelected] = useState(layers.length - 1);
  const layer = layers[selected]!;
  const linkClass = cn(chip, MONO, "mt-6 h-10 gap-2 rounded-lg px-4 text-[13px] font-medium uppercase tracking-[0.04em]");

  return (
    <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT + LIFT + SHADOW}`}
        aria-hidden="true"
        className="h-auto w-full max-w-[32rem] select-none lg:max-w-[44rem]"
      >
        <ellipse cx={CENTRE} cy={LIFT + HEIGHT + SHADOW / 2} rx={WIDTH * 0.46} ry={SHADOW / 2} className="fill-ink/15" />
        <g transform={`translate(0 ${LIFT})`}>
          {geometry.map(({ face, ledge }, index) => {
            const base = shade(index, geometry.length);
            const isSelected = index === selected;
            const middle = (face.y0 + face.y1) / 2;
            const apex = index === 0;
            // The apex is too narrow for its name, so that one is set beside it on a short leader.
            const leaderFrom = CENTRE + (face.top + face.bottom) / 4 + 6;
            return (
              <g
                key={layers[index]!.name}
                onClick={() => setSelected(index)}
                className="cursor-pointer transition-[transform,filter] duration-200 hover:brightness-110"
                style={{ transform: `translateY(${index < selected ? -LIFT : 0}px)` }}
              >
                {ledge ? <polygon points={outline(ledge)} style={{ fill: `color-mix(in oklab, ${base} 62%, white)` }} /> : null}
                <polygon
                  points={outline(face)}
                  strokeLinejoin="miter"
                  style={{
                    fill: base,
                    stroke: isSelected ? "var(--color-ink)" : "none",
                    strokeWidth: 4,
                    paintOrder: "stroke",
                    filter: isSelected ? "drop-shadow(0 0 6px var(--color-accent-line))" : "none",
                  }}
                />
                <polygon points={leftHalf(face)} style={{ fill: "color-mix(in oklab, black 16%, transparent)" }} />
                {apex ? (
                  <>
                    <line x1={leaderFrom} x2={CENTRE + face.bottom / 2 + 36} y1={middle} y2={middle} stroke="var(--color-ink)" strokeWidth={1.5} className="max-sm:hidden" />
                    <text
                      x={CENTRE + face.bottom / 2 + 46}
                      y={middle}
                      dominantBaseline="central"
                      fontSize={LABEL_SIZE}
                      fontWeight={isSelected ? 600 : 500}
                      style={{ fill: "var(--color-ink)" }}
                      className="pointer-events-none max-sm:hidden"
                    >
                      {layers[index]!.name}
                    </text>
                  </>
                ) : (
                  <text
                    x={CENTRE}
                    y={middle}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={LABEL_SIZE}
                    fontWeight={isSelected ? 600 : 500}
                    style={{ fill: labelFill(index) }}
                    className="pointer-events-none max-sm:hidden"
                  >
                    {layers[index]!.name}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div>
        <ul>
          {layers.map((item, index) => (
            <li key={item.name}>
              <button
                type="button"
                aria-pressed={index === selected}
                onClick={() => setSelected(index)}
                className={cn(
                  rowLink,
                  "flex w-full items-center px-[14px] py-[12px] text-left text-[1.25rem]",
                  index === selected && "bg-accent-soft shadow-[inset_3px_0_0_var(--color-accent)]",
                )}
              >
                {item.name}
              </button>
            </li>
          ))}
        </ul>
        <div aria-live="polite" className="mt-8 border-t border-line pt-8">
          <h3 className="font-serif text-[2rem] font-normal leading-[1.1] tracking-[-0.03em]">{layer.name}</h3>
          <p className="mt-3 max-w-[48ch] text-lg leading-relaxed text-muted">{layer.role}</p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {layer.tech.map((item) => (
              <li key={item} className={cn(MONO, "rounded-md bg-raised px-3 py-1 text-sm")}>
                {item}
              </li>
            ))}
          </ul>
          {layer.link ? (
            layer.link.external ? (
              <a href={layer.link.href} target="_blank" rel="noreferrer" className={linkClass}>
                {layer.link.label}
                <ArrowIcon />
              </a>
            ) : (
              <Link href={layer.link.href} className={linkClass}>
                {layer.link.label}
                <ArrowIcon />
              </Link>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
