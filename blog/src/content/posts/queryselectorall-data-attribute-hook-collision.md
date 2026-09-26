---
title: "document.querySelectorAll matched <html> and wiped the page"
description: "document.querySelectorAll(\"[data-tz]\") also matched <html>, so setting textContent erased the page. Give data-* JavaScript hooks names nothing else uses."
date: 2026-09-27
tags: [javascript, astro, static-sites]
takeaways:
  - "document.querySelectorAll searches the whole document, so an attribute selector like [data-tz] also matches the <html> element when <html> carries that attribute."
  - "Setting textContent on document.documentElement removes <head> and <body> and leaves one text node, so the page loses its content, styles, and title."
  - "A data attribute used as a JavaScript hook needs a name that no other element in the page uses, for configuration or anything else."
  - "Element.querySelectorAll only returns descendants, so document.body.querySelectorAll or document.documentElement.querySelectorAll can never match <html> itself."
---

The live clock on my portfolio updated every element that matched `[data-tz]`. The `<html>` element carried `data-tz` too, as configuration for the clock, so the first tick set the text of the whole document and replaced the page with one line of text. The fix was to rename the hook to `data-tzlabel`, so the selector for "elements to write into" no longer shared a name with "the setting to read".

The lesson is general: a data attribute used as a JavaScript hook needs a name that nothing else in the page uses. Below is why the selector matched `<html>`, what `textContent` does to the root element, and the checks that keep hook names from colliding.

## How the clock reads its configuration

The site's base layout, `src/layouts/Base.astro`, puts the time zone on the root element:

```astro
<html lang="en" data-tz={site.timezone}>
```

`site.timezone` is `"America/Toronto"` in `src/data/site.ts`. The attribute has been on `<html>` since the first Astro version of the site, where an inline script read it with `document.documentElement.getAttribute("data-tz")`. It is configuration: one value for the whole page.

The current clock lives in `src/scripts/console.ts`. It reads that value through [`dataset`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/dataset), then finds the elements to write into:

```ts
function startClock() {
  const tz = root.dataset.tz || "America/Toronto";
  const clocks = document.querySelectorAll<HTMLElement>("[data-clock]");
  const zones = document.querySelectorAll<HTMLElement>("[data-tzlabel]");
  if (!clocks.length) return;
  const time = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" });
  const tick = () => {
    const now = new Date();
    const hhmm = time.format(now);
    const abbr = zone.formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "";
    clocks.forEach((c) => (c.textContent = hhmm));
    zones.forEach((z) => (z.textContent = abbr));
  };
  tick();
  window.setInterval(tick, 15_000);
}
```

`root` is `document.documentElement`. The time zone labels in the top bar and the contact section are spans marked `data-tzlabel`:

```astro
<span class="tz" data-tzlabel>{site.timezoneLabel}</span>
```

Before the rename, those spans were marked `data-tz` and the query was `[data-tz]`. The same attribute name did two jobs: it held the time zone on `<html>`, and it marked the spans the clock should overwrite.

## Why document.querySelectorAll matches the html element

[`Document.querySelectorAll`](https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelectorAll) searches every element in the document, and that includes the root. An [attribute selector](https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors) such as `[data-tz]` matches any element that has the attribute, whatever its value and whatever its tag. `<html data-tz="America/Toronto">` has it, so it is in the result, and it comes first because results are in document order.

I reproduced this in Chromium with a minimal page:

```html
<!doctype html>
<html lang="en" data-tz="America/Toronto">
  <head><title>t</title><style>body { color: red }</style></head>
  <body><span data-tz>ET</span><span data-clock>--:--</span></body>
</html>
```

Then ran this in the page:

```js
[...document.querySelectorAll("[data-tz]")].map((e) => e.tagName);
// ["HTML", "SPAN"]
document.querySelectorAll("[data-tz]").forEach((z) => (z.textContent = "EDT"));
document.documentElement.outerHTML;
// '<html lang="en" data-tz="America/Toronto">EDT</html>'
```

## What textContent does to document.documentElement

Setting [`textContent`](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent) on an element removes all of its children and inserts a single text node. On `<html>`, the children are `<head>` and `<body>`. After the loop above, `document.head` and `document.body` were both `null` and `document.title` was an empty string. The style element went with `<head>`, so the browser showed the text without any of the page's styles.

The loop also wrote into the span, but by then the span had already been removed along with `<body>`. The write succeeded on a detached node, so nothing threw an error. The script did exactly what it said, and the page was gone.

## Scoping the query so it cannot match the root

Renaming the hook fixed the collision. Scoping the query is a second guard. [`Element.querySelectorAll`](https://developer.mozilla.org/en-US/docs/Web/API/Element/querySelectorAll) returns only descendants of the element it is called on, never the element itself. In the same test page:

| Call | Result |
| --- | --- |
| `document.querySelectorAll("[data-tz]")` | `HTML`, `SPAN` |
| `document.documentElement.querySelectorAll("[data-tz]")` | `SPAN` |
| `document.body.querySelectorAll("[data-tz]")` | `SPAN` |

Every element the clock writes into sits inside `<body>`, so `document.body.querySelectorAll` would have excluded `<html>` even with the old names. It does not help when two elements inside `<body>` share a name, so it backs up a unique name. It does not replace one.

## Naming data attributes used as JavaScript hooks

After the rename, the roles are separate:

| Attribute | Where | Role |
| --- | --- | --- |
| `data-tz` | `<html>` | Configuration: the IANA time zone name |
| `data-clock` | Spans in the top bar and contact section | Hook: receives `HH:MM` |
| `data-tzlabel` | Spans in the top bar and contact section | Hook: receives the zone abbreviation |
| `data-theme` | `<html>` | State: `light` when the light theme is on |

`data-theme` shows the other side of the rule. CSS in `src/styles/global.css` selects `:root[data-theme="light"]`, and `console.ts` reads it with `root.getAttribute("data-theme")`. Nothing queries `[data-theme]` across the document to write into the matches, so its name never needs to be unique among hooks.

A quick audit lists every attribute selector the scripts query, which you can compare against the attributes on `<html>` and `<body>`:

```bash
grep -rhoE 'querySelector(All)?(<[^>]+>)?\("\[[a-z-]+' src | grep -oE '\[[a-z-]+' | sort -u
```

On this repo that prints 13 names, from `[data-clock]` to `[data-tzlabel]`. The only data attributes on `<html>` are `data-tz` and `data-theme`, and neither is in the list.

## A live clock needs its own test setup

The clock is also the part of the page that changes between two loads, which is why the pixel checks in [proving an npm upgrade changed nothing](/pixel-diff-dependency-upgrades/) freeze the browser clock before each screenshot. The clock and the rest of the ops console design are covered in [rebuilding my portfolio as an ops console](/rebuilding-my-portfolio-as-an-ops-console/).
