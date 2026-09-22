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
