---
title: Why the name
description: How Spaghetti Junction became Hallway, the names considered on the way, and the corridors behind the design.
---

Hallway started life with a different name, and a different picture in mind.

## It began as Spaghetti Junction

The first mental image was the mess itself: a machine knotted with servers on random ports, which the tool would
untangle. **Spaghetti Junction** is the popular name of the Gravelly Hill Interchange, junction 6 of the M6 in
Birmingham, England, a famously tangled knot of flyovers and slip roads, proverbially the most complicated road
junction in Britain. A reverse proxy is a kind of junction too, so the name described the problem and the function at
once.

It came with a visual identity to match: British motorway signage, all route numbers and direction signs. The
package would have been `spaghetti-junction`, and the command `sj`.

## Why it was renamed

In October 2026, before any code was written, the project was renamed. The old name was:

- **too long, and hyphenated**: a single word was wanted;
- **cryptic at the command line**: `sj` meant nothing to anyone who hadn't heard the story;
- **about the wrong thing**: it named the mess, not the tidy result you actually want.

## Names considered

The original naming round had looked at pasta and roads: `colander`, `orzo`, `noodle`, `skein`, `tangle`,
`untangle`, `switchboard`, `interchange`, `porthole` and more, nearly all already taken on npm. (`aldente` was free,
but shares its name with a well-known macOS battery utility.)

The rename went looking for words about arriving, gathering and finding your way: `porter`, `portico`, `concierge`,
`foyer`, `lobby`, `wrangler`, `muster`, `flyover`, `slipway`, `signpost`, `fingerpost` and `beacon` were all taken.
The free shortlist was `strays`, `pinfold`, `foundling`, `digory`, `otherwood`, `kenning`, `dewpond`, `gyratory` and
`sliproad`.

**Hallway** beat them all because it was the most ordinary word on the list, and because it extended a phrase the
project already used about itself: *the front door for everything you vibe-coded on a random port*. If the product
is the front door, the dashboard is the hallway behind it, the place where all the doors are. It is plain, easy to
say and to spell, one word, and it describes the cure (a calm, tidy home where you know what is behind every door)
rather than the disease. The default port followed: **4255** spells HALL on a phone keypad.

## The hallway

The design follows the name. The dashboard is a calm, well-kept hallway at night, lit by warm lamps. Each app is a
**door**, and its port is the **door number** on a brass plate. A door's state shows the app's health: **ajar**, with
a sliver of light, means healthy; **closed** means stopped on purpose; **dark, or boarded up**, means down.
Servers the scanner found but nobody has named are **noises behind doors you didn't know were there**. Bookmarks to
remote places hang on a **key hook by the front door**. And after a reboot, the doors that closed while you were away
are listed, each with a way to open it again.

The feeling to aim for is *coming home and knowing where everything is*: not a control room, not a server rack, and
not a haunted house.

## Corridors of doors

Three imagined places shaped that picture. Hallway borrows their feeling, never their art.

**L-space.** In Terry Pratchett's Discworld novels, every library is connected to every other library, because books
bend space. Hallway's corridor likewise connects every place you work: local apps through its doors, remote ones
through the bookmarks by the front door.

**The corridor of doors in _Dark Matter_.** In the Apple TV+ series (2024), a box opens onto an endless corridor of
identical doors, each leading to a different version of the world, and the whole difficulty is that they all look
the same. That is a warning as much as an image: Hallway's doors must be *distinguishable* at a glance, each with its
own paint, number, name and `repo @ branch`, never a grid of identical rectangles.

**The Wood between the Worlds.** In C. S. Lewis's _The Magician's Nephew_, the prequel to the other Narnia books, two
children find a drowsy, quiet wood full of identical pools. Each pool leads to a different world, and the
place is so sleepy that you can forget which pool is home, so they mark theirs before they leave. That is the
original problem exactly: a machine full of identical-looking dev servers, and nobody remembering which is which.
Hallway's answer is the same as theirs: label every door.

:::note[Only a story]
These references are the backstory, not the brand. Hallway uses none of their imagery, characters, typography or
logos, and the design must make sense to someone who recognises none of them: it is a hallway first. _Narnia_ and
_Aslan_ are trademarks of their owners and appear here only to tell this story.
:::

## The logo

The arched door left ajar, with lamplight spilling across the floor, is a **placeholder** drawn for this site while
the hallway identity is the working direction. It will be replaced when the identity is finalised.
