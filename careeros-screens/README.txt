Career OS — screen export
=========================

Open index.html to start. It lists the seven roadmap phases; each phase has its
own index with thumbnails, and each thumbnail opens that screen.

59 screens, 7 phases. Every screen is one self-contained HTML file at 1440x900:
the design tokens, the component stylesheet, React, the Career OS component
bundle and the Inter subset are all inlined. No network access is needed and
there is no folder to keep together -- a single file can be emailed on its own
and will still render exactly as designed.

What is live in the file
  - the page entrance animation (nav, header, toolbar, content, on 40ms beats)
  - hover states on cards, rows, navigation, buttons and tabs
  - the open dropdown, modal, toast and tooltip patterns where a screen uses them
  - prefers-reduced-motion: the whole motion layer collapses if your OS asks it to

Navigation
  The bar at the top of each screen steps through that phase and returns to its
  index. Links inside a screen go to the real target wherever that screen has
  been designed, including across phases.

Not included
  Seven enrichment screens from the 67-screen inventory (20, 25, 26, 27, 30, 35,
  40) are deliberately deferred and have not been designed yet.
