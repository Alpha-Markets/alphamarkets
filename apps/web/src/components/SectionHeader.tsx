import type { ReactNode } from "react";
import { PAGE_FRAME, SECTION_TITLE } from "@/lib/frame";

/// The start of a landing page section: a 2 px ink rule across the page, then the title on the page
/// gutters with an optional action on the right and an optional line under it. The rule marks where a
/// section begins; the title carries the weight.
export function SectionHeader({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-t-2 border-ink">
      <div className={`${PAGE_FRAME} pb-6 pt-6 lg:pb-8 lg:pt-8`}>
        <div className="flex items-end justify-between gap-3">
          <h2 id={id} className={SECTION_TITLE}>
            {title}
          </h2>
          {action}
        </div>
        {children}
      </div>
    </div>
  );
}
