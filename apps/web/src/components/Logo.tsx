import Image from "next/image";
import mark from "@/assets/alphamarkets-mark.png";

/// The AlphaMarkets mark, and its wordmark at the `lg` size only (the footer's brand lockup). The
/// mark is the only teal on the site: everything else stays charcoal and off-white, so it is the one
/// thing that carries the brand. It is decorative beside the wordmark, so it has no alt text of its
/// own. The header (`md`) stays mark-only, cleaner at the header's own smaller scale; the link around
/// it has its own aria-label.
export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className="inline-flex items-center gap-3">
      <Image src={mark} alt="" priority className={size === "lg" ? "h-10 w-auto" : "h-8 w-auto"} />
      {size === "lg" ? <span className="text-sm font-medium tracking-[0.32em]">ALPHAMARKETS</span> : null}
    </span>
  );
}
