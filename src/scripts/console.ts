// Client behavior for the ops console: theme toggle, local clock, active
// section nav, copy-to-clipboard, and the ⌘K command palette.
// Everything here is progressive enhancement; the page reads fine without it.

const root = document.documentElement;
const THEME_COLOR = { dark: "#080b10", light: "#f4f5f7" };

function isLight() {
  return root.getAttribute("data-theme") === "light";
}

function paintTheme() {
  const light = isLight();
  document.querySelector("#theme-color")?.setAttribute("content", light ? THEME_COLOR.light : THEME_COLOR.dark);
  document.querySelectorAll<HTMLElement>("[data-toggle]").forEach((b) => {
    b.setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
    const l = b.querySelector("[data-tl]");
    if (l) l.textContent = light ? "dark" : "light";
  });
}

function toggleTheme() {
  const light = !isLight();
  if (light) root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
  try {
    localStorage.setItem("theme", light ? "light" : "dark");
  } catch {
    /* storage blocked: theme still flips for this page view */
  }
  paintTheme();
}

let toastTimer: number | undefined;
function toast(msg: string) {
  const t = document.querySelector<HTMLElement>("[data-toast]");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("on");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("on"), 1800);
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`copied ${text}`);
  } catch {
    toast("copy failed · select the address instead");
  }
}

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

function watchSections() {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-nav]"));
  const sections = document.querySelectorAll<HTMLElement>("main section[id]");
  if (!links.length || !sections.length || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        links.forEach((l) => {
          const on = (l.getAttribute("href") || "").endsWith(`#${e.target.id}`);
          l.classList.toggle("on", on);
          if (on) l.setAttribute("aria-current", "true");
          else l.removeAttribute("aria-current");
        });
      });
    },
    { rootMargin: "-35% 0px -60% 0px" },
  );
  sections.forEach((s) => io.observe(s));
}

function palette() {
  const dlg = document.querySelector<HTMLDialogElement>("[data-palette]");
  if (!dlg || typeof dlg.showModal !== "function") {
    // No <dialog> support: hide the triggers rather than show dead buttons.
    document.querySelectorAll<HTMLElement>("[data-palette-open]").forEach((b) => (b.hidden = true));
    return;
  }
  const input = dlg.querySelector<HTMLInputElement>("input")!;
  const items = Array.from(dlg.querySelectorAll<HTMLButtonElement>("[data-cmd]"));
  const empty = dlg.querySelector<HTMLElement>("[data-empty]");
  let active = 0;

  const visible = () => items.filter((i) => !i.parentElement!.hidden);

  const highlight = (n: number) => {
    const v = visible();
    if (!v.length) return;
    active = (n + v.length) % v.length;
    v.forEach((el, i) => el.setAttribute("aria-selected", String(i === active)));
    if (dlg.open) v[active].scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", v[active].id);
  };

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

  const open = () => {
    if (dlg.open) return;
    input.value = "";
    filter();
    dlg.showModal();
    input.focus();
  };

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

  input.addEventListener("input", filter);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlight(active + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlight(active - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const v = visible();
      if (v[active]) run(v[active]);
    }
  });
  items.forEach((el) => {
    el.addEventListener("click", () => run(el));
    el.addEventListener("mousemove", () => {
      const i = visible().indexOf(el);
      if (i !== active) highlight(i);
    });
  });
  // Click on the backdrop (the dialog box itself, outside the card) closes.
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });

  document.querySelectorAll("[data-palette-open]").forEach((b) => b.addEventListener("click", open));

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
}

export function initConsole() {
  paintTheme();
  document.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", toggleTheme));

  document.querySelectorAll<HTMLElement>("[data-copy]").forEach((b) =>
    b.addEventListener("click", () => copy(b.dataset.copy || "")),
  );

  // Show the right modifier key: ⌘ on Apple platforms, Ctrl elsewhere.
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  document.querySelectorAll("[data-mod]").forEach((k) => (k.textContent = mac ? "⌘" : "Ctrl "));

  startClock();
  watchSections();
  palette();
}
