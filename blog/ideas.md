# Blog ideas

Raw notes for the daily blog routine (claude.ai/code/routines). It reads
this file first, writes one post from an idea, and removes that bullet in
the same commit. With no usable idea here it falls back to topics from
this repo's own code, and skips the day when those run out.

Put real material in: incidents, fixes, numbers you're allowed to share,
things you learned, tools you tried. Short bullets are fine. The routine
will not invent details, so a bullet with no facts makes a thin post or
none at all.

This file is public in the repo. Customer names, internal hostnames,
credentials, and anything under NDA do not belong here.

## Ideas

- Pinning GitHub Actions to SHAs: the annotated-tag trap (pinned the tag
  object instead of the commit; the deploy failed with "dist/index.mjs not found")
- Cloudflare in front of GitHub Pages: what the edge rewrites (Rocket Loader,
  email obfuscation, analytics beacon) and how it interacts with a CSP
