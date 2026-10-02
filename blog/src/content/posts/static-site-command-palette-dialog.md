---
title: "A command palette for a static site in 4 KB of JavaScript"
description: "A Cmd+K and / command palette for an Astro static site built on the native dialog element, rendered at build time and filtered by a short script."
date: 2026-10-03
tags: [javascript, astro, static-sites]
takeaways:
  - "A native <dialog> opened with showModal() gives a command palette Escape to close, a backdrop, and an inert page behind it without any library."
  - "Rendering the command list at build time as buttons with data-cmd and data-arg attributes leaves the script with only filtering, keyboard movement, and dispatch."
  - "Matching every space-separated word of the query against the label plus a hidden keywords attribute lets 'cop em' find 'Copy email address' and 'hire' find 'Email Sanjay'."
  - "The / shortcut should be ignored while focus is in an input, textarea, or contenteditable element, while Cmd+K or Ctrl+K can work everywhere."
  - "If HTMLDialogElement.showModal is missing, hiding the palette triggers is better than showing buttons that do nothing."
---

My portfolio and this blog share a command palette. Press `/` or `Cmd+K` (`Ctrl+K` off Apple platforms) and it opens a list of commands: jump to a section, email or copy my address, open LinkedIn, or switch theme. It is a native `<dialog>` element whose list Astro renders at build time, plus one function in a TypeScript file that filters and runs commands. No framework, no fuzzy-search library.

The whole client bundle for the site, which also runs the theme toggle, the live clock, and the section highlighting, builds to 4,234 bytes of minified JavaScript (1,825 bytes gzipped) on the current build. Below is how the two files split the work, and the details that make it behave like a real palette.

## How the markup and the script split the work

There are two files:

| File | Runs | Job |
| --- | --- | --- |
| `src/components/CommandPalette.astro` | At build time | Builds the command list and renders the `<dialog>` |
| `src/scripts/console.ts` | In the browser | Opens, filters, moves the selection, runs a command |

The component turns the site's data into a list of commands. Navigation entries come from a `nav` prop, and the actions come from `src/data/site.ts`:

```ts
type Cmd = { group: string; label: string; hint: string; cmd: string; arg?: string; keywords?: string };
const cmds: Cmd[] = [
  ...nav.map((n) => ({ group: "navigate", label: `Go to ${n.label}`, hint: n.href.replace(/^https:\/\/|^\//, ""), cmd: "goto", arg: n.href })),
  { group: "actions", label: "Email Sanjay", hint: "mailto", cmd: "mail", arg: site.email, keywords: "contact page hire" },
  { group: "actions", label: "Copy email address", hint: site.email, cmd: "copy", arg: site.email, keywords: "clipboard contact" },
  ...(linkedin ? [{ group: "actions", label: "Open LinkedIn", hint: "↗", cmd: "open", arg: linkedin.href, keywords: "social profile" }] : []),
  { group: "actions", label: "Toggle theme", hint: "dark / light", cmd: "theme", keywords: "mode color appearance" },
];
```

Each command becomes a `<button>` carrying its verb and argument as data attributes:

```astro
<button
  type="button"
  role="option"
  id={`cmd-${g}-${i}`}
  data-cmd={c.cmd}
  data-arg={c.arg}
  data-keywords={c.keywords}
>
```

Because the `nav` prop drives the navigate group, the same component serves both sites. The portfolio passes its section links (`/#signals`, `/#status`, and so on). The blog layout passes `blogNav` from `blog/src/lib/posts.ts`, so here the palette lists posts, tags, the RSS feed, and the main site instead.

The script never builds DOM. It reads the buttons that are already in the page and reacts to them. That keeps the bundle small and means the command list is plain HTML that any crawler or screen reader can see.

## Why the native dialog element does most of the work

The palette is a [`<dialog>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog) opened with [`showModal()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal). A modal dialog brings several things a hand-built overlay has to write itself:

- `Escape` closes it.
- The `::backdrop` pseudo-element styles the layer behind it. Here that is a dark tint with a 3 px blur.
- The rest of the page becomes inert, so `Tab` cannot reach links behind the palette.
- It renders in the top layer, so no `z-index` fight with the sticky top bar.

The script adds one thing the element does not do: a click on the backdrop closes it. A click outside the card lands on the `<dialog>` element itself, so the check is a target comparison:

```ts
// Click on the backdrop (the dialog box itself, outside the card) closes.
dlg.addEventListener("click", (e) => {
  if (e.target === dlg) dlg.close();
});
```

This works because the dialog has no padding and a transparent background, and the visible box is a `.card` inside it. Clicks on the card have the card or a child as their target.

## Filtering commands by every word in the query

On each `input` event, the filter lowercases the query, splits it on whitespace, and hides any command whose text does not contain every word:

```ts
const filter = () => {
  const q = input.value.trim().toLowerCase();
  items.forEach((i) => {
    const hay = `${i.textContent} ${i.dataset.keywords ?? ""}`.toLowerCase();
    i.parentElement!.hidden = q !== "" && !q.split(/\s+/).every((w) => hay.includes(w));
  });
  // Hide a group heading once every command under it is filtered out.
  dlg.querySelectorAll<HTMLElement>("[data-grp]").forEach((g) => {
    g.hidden = !dlg.querySelector(`[data-in="${g.dataset.grp}"]:not([hidden])`);
  });
  if (empty) empty.hidden = visible().length > 0;
  highlight(0);
};
```

The searched text is the button's `textContent`, which includes the hint, plus the `data-keywords` attribute. I checked the behavior in Chromium against the built portfolio:

| Query | Visible commands |
| --- | --- |
| (empty) | All 11 |
| `cop em` | Copy email address |
| `hire` | Email Sanjay |
| `xyz` | None, and both group headings hidden |

`hire` matches only through the keywords, which is what they are for: words a visitor might type that do not appear in the label. With no match, the list shows `no matching command · exit 127`, which is the shell's exit code for "command not found".

Substring matching on every word is not fuzzy search. It will not match `cpy`. For a list of 11 commands, substring matching on whole words is enough.

## Keyboard selection with aria-activedescendant

Focus stays in the text input the whole time. The selected command is tracked as an index into the visible buttons, and the input points at it with [`aria-activedescendant`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-activedescendant), so a screen reader announces the option while the user keeps typing:

```ts
const highlight = (n: number) => {
  const v = visible();
  if (!v.length) return;
  active = (n + v.length) % v.length;
  v.forEach((el, i) => el.setAttribute("aria-selected", String(i === active)));
  if (dlg.open) v[active].scrollIntoView({ block: "nearest" });
  input.setAttribute("aria-activedescendant", v[active].id);
};
```

The modulo makes the selection wrap. Pressing `ArrowUp` on the first command selects the last one, which in the test above was `cmd-actions-3`, the theme toggle. Every filter run resets the selection to the first visible command, and `Enter` runs whichever command is selected. Moving the mouse over a command selects it too, so keyboard and pointer never disagree about which row is highlighted.

The markup supplies the roles: the input is `role="combobox"` with `aria-controls="palette-list"`, the `<ul>` is `role="listbox"`, and each button is `role="option"`. The `<li>` wrappers and group headings are `role="presentation"`. Those IDs are why every button gets a stable `id` at build time.

## Running a command from data-cmd

Dispatch is a chain of string comparisons on `data-cmd`. The dialog closes before the command runs:

```ts
const run = (el: HTMLButtonElement) => {
  const { cmd, arg = "" } = el.dataset;
  dlg.close();
  if (cmd === "goto") {
    location.href = arg;
  } else if (cmd === "open") {
    window.open(arg, "_blank", "noopener");
  } else if (cmd === "mail") {
    location.href = `mailto:${arg}`;
  } else if (cmd === "copy") {
    copy(arg);
  } else if (cmd === "theme") {
    toggleTheme();
  }
};
```

`copy` and `toggleTheme` are the same functions the page's own buttons call. `copy` uses [`navigator.clipboard.writeText`](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText) and shows a toast. If the write fails, the toast says `copy failed · select the address instead`. `toggleTheme` flips `data-theme` on `<html>` and stores the choice in `localStorage`. Running "Toggle theme" from the palette in the test left `data-theme="light"` on the root and `"light"` under the `theme` key.

Adding a command means one line in the `cmds` array and, for a new verb, one more branch here.

## Binding / and Cmd+K without breaking text fields

Both shortcuts are one `keydown` listener on the document:

```ts
document.addEventListener("keydown", (e) => {
  const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]");
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (dlg.open) dlg.close();
    else open();
  } else if (e.key === "/" && !typing && !dlg.open) {
    e.preventDefault();
    open();
  }
});
```

The two keys get different rules:

- `/` is a character people type, so it only opens the palette when focus is not in an `input`, `textarea`, or `contenteditable` element, and the palette is closed. Inside the palette's own input, `/` types a slash.
- `Cmd+K` or `Ctrl+K` is a chord nobody types as text, so it works everywhere and toggles: pressed with the palette open, it closes it.

`open()` clears the input and reruns the filter before calling `showModal()`, so the palette always starts with the full list and the first command selected.

The hint in the top bar and the palette footer shows the right modifier. On load, the script sets every `[data-mod]` element to `⌘` when `navigator.platform` (or the user agent, if that is empty) matches `Mac`, `iPhone`, or `iPad`, and to `Ctrl` otherwise.

## Progressive enhancement when showModal is missing

The top of `console.ts` states the rule for all of it: the page reads fine without the script. The palette only repeats links and actions that already exist on the page. If a browser has no `showModal`, the script hides the trigger buttons instead of leaving a button that does nothing:

```ts
if (!dlg || typeof dlg.showModal !== "function") {
  // No <dialog> support: hide the triggers rather than show dead buttons.
  document.querySelectorAll<HTMLElement>("[data-palette-open]").forEach((b) => (b.hidden = true));
  return;
}
```

All the hooks above use their own `data-*` names, such as `data-palette`, `data-cmd`, and `data-grp`. That matters more than it looks: a shared attribute name once let another script on this site [match the html element and wipe the page](/queryselectorall-data-attribute-hook-collision/). The palette is one part of the design described in [rebuilding my portfolio as an ops console](/rebuilding-my-portfolio-as-an-ops-console/).
