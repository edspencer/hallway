---
'hallway': patch
---

`hallway service install` (and any other command that would write a job running Hallway itself: on Windows, every job) now refuses when Hallway is running from npx's cache, which npm can delete at any time, and says to `npm i -g hallway` first. `hallway doctor` warns about a job that already does, with the fix `npm i -g hallway && hallway service regenerate`. `npx hallway` in the foreground still works: it's the way to try Hallway, and `npm i -g hallway && hallway service install` the way to keep it.
