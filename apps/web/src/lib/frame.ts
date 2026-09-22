/// Width and side gutters shared by the header and the landing page, so the wordmark and the wallet
/// button sit on the same left and right edges as the page content. The trading pages keep their
/// own full-width layouts.
export const PAGE_FRAME =
    'mx-auto w-full max-w-[1600px] px-4 sm:px-8 lg:px-[42px] xl:px-[70px]';

/// The heading of a landing page section, in the voice of the hero title: serif, tight tracking. Regular
/// weight and full ink, because the light weight was the faintest text on the page.
export const SECTION_TITLE =
    'font-serif text-[2.25rem] font-normal leading-[1.1] tracking-[-0.03em] text-ink sm:text-[3.25rem]';

/// For verifiable data only — a contract address, a chain name, a tech-stack tag — never prices or
/// tickers, which stay in the sans everywhere else so the landing page still matches the terminal.
export const MONO = 'font-mono tabular-nums';

/// A small tracked uppercase label, on a button or a chip-style link. One source instead of the same
/// string re-typed in every caller — the tracked-caps treatment itself is a deliberate financial-
/// terminal convention (PROJECT_BRIEF.md's "precise typography"), not the generic eyebrow-label tell;
/// this only removes the duplication.
export const CHIP_LABEL = 'text-[13px] font-medium uppercase tracking-[0.04em]';
