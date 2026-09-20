import Image from "next/image";
import mark from "@/assets/alphamarkets-mark.png";

/// The AlphaMarkets mark and wordmark. The mark is the only teal on the site: everything else stays
/// charcoal and off-white, so it is the one thing that carries the brand. The mark is decorative
/// beside the wordmark, so it has no alt text of its own.
export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className="inline-flex items-center gap-3">
      <Image src={mark} alt="" priority className={size === "lg" ? "h-10 w-auto" : "h-8 w-auto"} />
      <span className="text-sm font-medium tracking-[0.32em]">ALPHAMARKETS</span>
    </span>
  );
}
