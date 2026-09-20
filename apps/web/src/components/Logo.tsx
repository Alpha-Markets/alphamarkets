import Image from "next/image";
import mark from "@/assets/alphamarkets-mark.png";

/// The AlphaMarkets mark and wordmark. The mark is the only teal on the site: everything else stays
/// charcoal and off-white, so it is the one thing that carries the brand. The mark is decorative
/// beside the wordmark, so it has no alt text of its own. The header size drops the wordmark below
/// 480 px, where it would run into the wallet button; the link around it has its own aria-label.
export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className="inline-flex items-center gap-3">
      <Image src={mark} alt="" priority className={size === "lg" ? "h-10 w-auto" : "h-8 w-auto"} />
      <span className={size === "lg" ? "text-sm font-medium tracking-[0.32em]" : "hidden text-sm font-medium tracking-[0.32em] min-[480px]:inline"}>ALPHAMARKETS</span>
    </span>
  );
}
