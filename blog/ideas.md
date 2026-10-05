# Blog topic queue

The daily blog routine (claude.ai/code/routines) writes one post a day about
what changed in the past week, rotating through four areas: DevOps, SRE,
AIOps, and cybersecurity. It finds topics itself by searching the news and
primary sources.

To steer it, add a bullet under **Queue**: a topic, a link (release notes,
advisory, postmortem), or both. The routine takes the top queued item first,
writes the post, and removes the bullet in the same commit. With an empty
queue it picks the most useful news of the week in that day's area.

This file is public in the repo. Customer names, internal hostnames,
credentials, and anything under NDA do not belong here.

## Queue

