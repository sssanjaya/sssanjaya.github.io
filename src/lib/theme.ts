// No-flash theme bootstrap shared by the site and the blog: dark by default,
// stored "light" opts out. It must run inline in <head>, so the CSP allows it
// by hash. The hash is computed from these exact bytes at build time, so
// editing the script can never leave a stale hash behind.
import { createHash } from "node:crypto";

export const themeBootstrap = `(function () {
  try {
    if (localStorage.getItem("theme") === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      var tc = document.querySelector("#theme-color");
      if (tc) tc.setAttribute("content", "#f4f5f7");
    }
  } catch (e) {}
})();`;

export const themeBootstrapHash = `sha256-${createHash("sha256").update(themeBootstrap).digest("base64")}` as const;
