# Blog ideas

Raw notes for the weekly AI drafts job (`.github/workflows/blog-drafts.yml`).
It reads this file first and builds outlines from what you write here, so
put real material in: incidents, fixes, numbers you're allowed to share,
things you learned, tools you tried. Short bullets are fine.

Delete or strike an idea once it has become a post. Anything you would not
want published (customer names, internal hostnames, credentials) does not
belong here: this file is public in the repo.

## Ideas

- Pinning GitHub Actions to SHAs: the annotated-tag trap (pinned the tag
  object instead of the commit; the deploy failed with "dist/index.mjs not found")
- Cloudflare in front of GitHub Pages: what the edge rewrites (Rocket Loader,
  email obfuscation, analytics beacon) and how it interacts with a CSP
