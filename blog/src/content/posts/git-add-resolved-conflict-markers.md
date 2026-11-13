---
title: "git add --resolved: Stop Committing Conflict Markers"
description: "git add . silently stages leftover conflict markers and stray edits. Git 2.56 adds git add --resolved, which refuses. Lab output and an old-Git fix."
date: 2026-11-13T11:08:13Z
tags: [git, terminal]
takeaways:
  - "During a conflicted merge, git add . and git add -u stage files that still contain conflict markers, and git commit records them without any error."
  - "Git 2.56 added git add --resolved, which stages only unmerged paths and refuses to stage anything if any selected path still has conflict markers."
  - "git add --resolved leaves unrelated edits and untracked files out of the merge commit, so a debug change made mid-merge stays in the working tree."
  - "A line of exactly seven equals signs, such as an RST heading underline, counts as a conflict marker; the conflict-marker-size attribute in .gitattributes avoids the false positive."
  - "On Git older than 2.56, a pre-commit hook that runs git diff --cached --check blocks commits that contain leftover conflict markers."
---

Resolve one of two conflicted files, type `git add .`, commit, and Git records `<<<<<<< HEAD` in your config file with exit code 0. [Git 2.56](https://github.com/git/git/blob/v2.56.1/Documentation/RelNotes/2.56.0.adoc) added `git add --resolved`, which stages only conflicted paths and refuses outright while any of them still holds a marker. Git 2.56.1 shipped on 10 November 2026 as a [security release](https://github.com/git/git/blob/v2.56.1/Documentation/RelNotes/2.56.1.adoc), so if you upgrade this week you get `--resolved` too. This lab runs both versions against the same broken merge.

<figure>
  <img src="/diagrams/git-add-resolved-conflict-markers-staging.svg" alt="Side by side lab results. A merge stopped with app.conf still holding conflict markers, main.py resolved, notes.txt carrying an unrelated debug edit, and an untracked debug.log. Left, Git 2.43.0: git add . stages all four paths and git commit creates merge commit 9deb978 with 4 files changed and the markers on lines 1 and 5 of app.conf. Right, Git 2.56.1: git add --resolved exits 128 naming app.conf; after the fix it stages app.conf and main.py only, and the merge commit has 2 files changed." width="960" height="600" loading="lazy" />
  <figcaption>Same conflicted merge, two commands. <code>git add .</code> commits the markers and the noise; <code>git add --resolved</code> blocks, then stages only the conflict. Source: sandbox run with Git 2.43.0 and 2.56.1.</figcaption>
</figure>

## The lab setup

Two branches change the same lines in `app.conf` and `main.py`, so `git merge feature` stops with both files unmerged. While the merge is open, a debug line goes into `notes.txt` and a `debug.log` file appears, the kind of noise any working tree collects. Then only `main.py` gets resolved:

```text
$ git status --short
UU app.conf
UU main.py
 M notes.txt
?? debug.log

$ cat app.conf
<<<<<<< HEAD
timeout_ms = 800
=======
timeout_ms = 2000
>>>>>>> feature
retries = 2
```

Git 2.56.1 was built from the [kernel.org tarball](https://mirrors.edge.kernel.org/pub/software/scm/git/) (SHA-256 checked against `sha256sums.asc`). Git 2.43.0 is the Ubuntu package already in the sandbox.

## Before: what git add . commits

Running the common habit on Git 2.43.0:

```text
$ git add .
$ git status --short
M  app.conf
A  debug.log
M  main.py
M  notes.txt
$ git commit --no-edit
[main 9deb978] Merge branch 'feature'
$ git show --stat --format='%h %s' HEAD
9deb978 Merge branch 'feature'

 app.conf  | 4 ++++
 debug.log | 1 +
 main.py   | 2 +-
 notes.txt | 1 +
 4 files changed, 7 insertions(+), 1 deletion(-)
$ git grep -n -e '^<<<<<<<' -e '^>>>>>>>' HEAD -- .
HEAD:app.conf:1:<<<<<<< HEAD
HEAD:app.conf:5:>>>>>>> feature
```

No warning at any step. Staging a file is how Git learns a conflict is resolved, so `git add` on a file full of markers marks it resolved. The merge commit now carries a broken config, a debug edit, and a log file.

`git add -u` is only slightly better. It skipped the untracked `debug.log` but still staged the markers and `notes.txt`. Running `git add .` on Git 2.56.1 stages all four paths exactly like 2.43.0: the old commands did not change.

## After: git add --resolved on Git 2.56.1

The [git-add manual](https://github.com/git/git/blob/v2.56.1/Documentation/git-add.adoc) defines the new option:

> Update the index for unmerged paths matching _&lt;pathspec&gt;_ where no conflict markers remain in the working tree. Unmerged paths without conflict markers (including binary files and file deletions) are staged as resolved, while any path with leftover conflict markers causes the command to refuse to stage any files.

Same repo state, new command:

```text
$ git --version
git version 2.56.1
$ git add --resolved
fatal: the following paths still have conflict markers:
	app.conf

$ echo $?
128
$ git status --short
UU app.conf
UU main.py
 M notes.txt
?? debug.log
```

Nothing was staged, not even the correctly resolved `main.py`. After fixing `app.conf`, the same command stages the two conflicted files and nothing else:

```text
$ git add --resolved
$ git status --short
M  app.conf
M  main.py
 M notes.txt
?? debug.log
$ git commit --no-edit
[main dcfb240] Merge branch 'feature'
$ git show --stat --format='%h %s' HEAD
dcfb240 Merge branch 'feature'

 app.conf | 2 +-
 main.py  | 2 +-
 2 files changed, 2 insertions(+), 2 deletions(-)
```

The debug edit and the log file stay in the working tree, outside the merge commit.

<figure>
  <img src="/diagrams/git-add-resolved-conflict-markers-matrix.svg" alt="Table of lab results for four paths. With app.conf still holding markers: git add . stages all four paths with exit 0; git add -u stages app.conf, main.py and notes.txt but not debug.log, exit 0; git add --resolved stages nothing, exit 128; git add --resolved main.py stages only main.py, exit 0. After fixing app.conf, git add --resolved stages app.conf and main.py and leaves notes.txt and debug.log untouched." width="960" height="440" loading="lazy" />
  <figcaption>Red cells are content that should not be in the merge commit. Only the <code>--resolved</code> columns avoid all of them. Source: sandbox run with Git 2.56.1 and 2.43.0.</figcaption>
</figure>

## The pathspec is the blast radius

The check is all-or-nothing within the paths you select. With `app.conf` still broken, a pathspec narrows the check to one file:

```text
$ git add --resolved main.py
$ git status --short
UU app.conf
M  main.py
 M notes.txt
?? debug.log
```

That is useful in a large merge: stage the files you finished and keep working. The option also refuses to mix with the broad forms:

```text
$ git add -u --resolved
fatal: options '-u/--update' and '--resolved' cannot be used together
```

## How Git decides a line is a marker

The check lives in [`has_conflict_markers()` in merge-ll.c](https://github.com/git/git/blob/v2.56.1/merge-ll.c). It reads each unmerged regular file line by line and stops at the first marker or the first binary-looking line. A marker line is N copies of `<`, `=`, `>` or `|`, followed by whitespace, where N is the `conflict-marker-size` attribute (default 7). `<` and `>` markers need a space after them.

<figure>
  <img src="/diagrams/git-add-resolved-conflict-markers-check.svg" alt="Flowchart: collect unmerged index entries matching the pathspec, scan each regular file line by line until a marker or binary line, then if any path has a marker exit 128 and stage nothing, otherwise stage all including deletions as removals. Side panel: a marker is 7 copies of less-than, equals, greater-than or pipe followed by whitespace; seven equals signs match, eight do not. A false positive: an RST heading underlined with exactly seven equals signs is refused, fixed with README.rst conflict-marker-size=32 in .gitattributes." width="960" height="520" loading="lazy" />
  <figcaption>One marker anywhere in the selection blocks every path. A seven-character <code>=======</code> heading underline trips the same rule. Source: <a href="https://github.com/git/git/blob/v2.56.1/merge-ll.c">merge-ll.c</a> and <a href="https://github.com/git/git/blob/v2.56.1/builtin/add.c">builtin/add.c</a> at v2.56.1.</figcaption>
</figure>

That rule has a false positive. reStructuredText and setext Markdown headings use a line of `=` signs. If the underline is exactly seven characters, `--resolved` treats it as a marker. In the lab, a conflicted `README.rst` resolved to this content was refused:

```text
$ cat README.rst
Changelog
=======

v2 merged
$ git add --resolved
fatal: the following paths still have conflict markers:
	README.rst
```

The [gitattributes manual](https://github.com/git/git/blob/v2.56.1/Documentation/gitattributes.adoc) documents `conflict-marker-size` for files that need longer markers. Setting it for that file made the same command pass:

```text
$ echo 'README.rst conflict-marker-size=32' > .gitattributes
$ git add --resolved
$ git status --short
M  README.rst
?? .gitattributes
```

The attribute also makes future merges of that file write 32-character markers, which is the point of it. A plain `git add README.rst` works as well, but skips the check for that file.

## On Git older than 2.56

`git diff --check` already knows about leftover markers. Its [documentation](https://github.com/git/git/blob/v2.56.1/Documentation/diff-options.adoc) says it will "Warn if changes introduce conflict markers or whitespace errors" and exit non-zero. On Git 2.43.0, a two-line pre-commit hook blocked the same bad merge commit:

```sh
#!/bin/sh
exec git diff --cached --check
```

```text
$ git add .
$ git commit --no-edit
app.conf:1: leftover conflict marker
app.conf:3: leftover conflict marker
app.conf:5: leftover conflict marker
$ echo $?
1
```

Two limits. The hook also fails on trailing whitespace, as defined by `core.whitespace`, which may be noisier than you want. And it does nothing about `notes.txt` and `debug.log`, which `git add .` still staged. `--resolved` fixes both problems at the staging step instead of the commit step.

## What to do

1. Check your version with `git --version`. Git 2.56.1 is the newest release on kernel.org as of 13 November 2026 and carries the [security fixes](https://github.com/git/git/blob/v2.56.1/Documentation/RelNotes/2.56.1.adoc) from 10 November 2026.
2. During merges, rebases, and cherry-picks, replace `git add .` and `git add -u` with `git add --resolved`. Use `git add --resolved <path>` to stage finished files in a large conflict.
3. Add an alias so the habit sticks: `git config --global alias.ar 'add --resolved'`.
4. If your repo has RST or Markdown files with seven-character `=======` underlines, set `conflict-marker-size` for them in `.gitattributes`, or lengthen the underline.
5. For machines stuck on older Git, install the `git diff --cached --check` pre-commit hook, and add the same check to CI so a marker that slips through still fails the build.
6. Search history for markers that already landed: `git grep -n -e '^<<<<<<< ' -e '^>>>>>>> ' HEAD`.
