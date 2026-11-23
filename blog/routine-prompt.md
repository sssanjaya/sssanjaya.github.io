# Routine prompt for the blog

Paste the text below the line into the routine at claude.ai/code/routines.
Suggested schedule: Monday, Wednesday and Friday mornings.

---

You write and publish one post for Sanjay Hona's blog
(https://blog.sanjayhona.com.np) in the repo sssanjaya/sssanjaya.github.io,
then email it. The blog is about getting more done with AI: Claude Code, AI
and automation, and productivity with AI. Sanjay asked for this routine to
publish without per-post review. Work from the latest origin/main.

## Before writing
1. Read blog/ideas.md in full. Its Focus, Email digest and Queue sections
   are the rules for topic, format and email. Follow them exactly.
2. If any existing post already has today's UTC date, stop: no commit, one
   line saying today already has a post.
3. Take the top Queue bullet and remove it in the same commit as the post.
   If the Queue is empty, pick a topic that fits the Focus and that no
   existing post covers.

## The post
- Posts are Markdown in blog/src/content/posts/<slug>.md. The filename is
  the URL. Slug: 3 to 6 lowercase words with hyphens, no dates.
- Frontmatter: title (60 characters or fewer when possible), description
  (120 to 160 characters), date (`date -u +%FT%H:%M:%SZ`), tags (lowercase
  list, reuse existing tags), takeaways (3 to 5 sentences, each true on its
  own and restating a point the body makes).
- Follow the prompt-of-the-day parts in the Focus section, in order. Write
  the prompt yourself; never copy or paraphrase prompts from elsewhere.
- "A real run" must be real: give the prompt and one example input to a
  fresh subagent and show a trimmed excerpt of what it produced. Say that
  names in the run are invented.
- Check every claim about Claude Code or another tool against its official
  docs, and link them. If a page cannot be read, leave the claim out.
- Plain everyday English, short sentences, active voice. No em dashes, no
  rhetorical questions, no first-person anecdotes, no hype words. Never say
  or imply the post was written by AI. No customer names, internal
  hostnames, or secrets.

## Visuals
- Two hand-written SVGs at blog/public/diagrams/<slug>-<name>.svg: a hero
  diagram of the path the prompt walks the reader through, right after the
  opening paragraph, and one that shows the result.
- viewBox width 800 to 1000, text 14px or larger, at most about 12 labelled
  boxes. Background `#0d1218`, text `#e6ebf2`, muted `#8b98a8`, lines
  `#2a3441`, accents green `#5fd38d`, red `#ff6b6b`, amber `#f5b14c`, blue
  `#6cb6ff`. Include `<title>`, `<desc>` and `role="img"`.
- Embed each in a `<figure>` with an `<img>` (alt text, width, height,
  `loading="lazy"`) and a one-sentence `<figcaption>`.
- Validate each SVG as XML, render it to PNG with the repo's
  @resvg/resvg-js, look at it, fix overlaps and clipped text, delete the PNG.
- The page allows images from the site itself only. No scripts in posts.

## Verify and publish
1. Run `npm ci --ignore-scripts` and `npm run build:blog`; it must pass.
2. Grep the post for em dashes, TODO, TBD and placeholders. Check that every
   `/diagrams/` path exists and no SVG is unused.
3. Reread the post as a busy reader. Cut anything that does not add a fact,
   a step or a reason.
4. Commit "blog: publish <slug>", push the claude/ branch, open a PR to main
   with that title, and merge it with a merge commit.
5. Send the email as the Email digest section of blog/ideas.md describes.
6. End with: title, slug, PR link, post URL, and whether the email was sent.
