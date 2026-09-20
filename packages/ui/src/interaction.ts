/// How every clickable thing looks and answers, in one place so the pages cannot drift apart. Nothing
/// clickable is a bare outline or bare text: at rest it is a solid fill, on hover it fills with the
/// accent tint and turns accent, and while pressed it fills solid accent. Market direction keeps its
/// own colours (green for long, red for short) and never uses the accent.
///
/// All of these need `transition-colors duration-150`, which `interactive` supplies.
export const interactive = "transition-colors duration-150";

/// A solid small button-like link (a row action, "Open the terminal"): raised fill at rest.
export const chip =
  `${interactive} inline-flex items-center rounded-md border border-line bg-raised text-text hover:border-accent hover:bg-accent-soft hover:text-accent active:border-accent active:bg-accent active:text-accent-ink`;

/// A pill in a row of choices (navigation, tabs). `selected` is the solid accent fill.
export const pill = (selected: boolean) =>
  `${interactive} inline-flex items-center rounded-md font-medium ${
    selected
      ? "bg-accent text-accent-ink"
      : "bg-raised text-muted hover:bg-accent-soft hover:text-accent active:bg-accent active:text-accent-ink"
  }`;

/// One line in a menu or a list you pick from: fills with the accent tint and a bar on its left edge.
export const menuItem = `${interactive} hover:bg-accent-soft hover:text-accent hover:shadow-[inset_3px_0_0_var(--color-accent)] active:bg-accent active:text-accent-ink active:shadow-none`;

/// A whole table row or list row that opens something.
export const rowLink = `${interactive} hover:bg-accent-soft hover:shadow-[inset_3px_0_0_var(--color-accent)] active:bg-accent-soft/60`;

/// A text link inside a sentence or a panel header: accent at rest, brighter on hover, darker pressed.
export const textLink = `${interactive} font-medium text-accent underline underline-offset-2 hover:text-accent-hover active:text-accent-press`;

/// A plain-looking link in a list (the footer): tints and fills on hover so it still answers boldly.
export const listLink = `${interactive} -mx-1.5 inline-flex w-fit rounded-md px-1.5 py-0.5 hover:bg-accent-soft hover:text-accent active:bg-accent active:text-accent-ink`;

/// The border of a field: it lights up on hover and stays lit while focused.
export const fieldBorder = `${interactive} border-line hover:border-accent-line focus:border-accent focus-within:border-accent`;
