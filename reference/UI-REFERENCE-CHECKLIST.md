# Chelo UI Reference Checklist

**Purpose:** Retain applicable ideas from historical Chessling V14 Stage 3.7 as inspiration. This is not a request to recreate that UI and does not override the current Chelo direction.

## Visual language
- Restrained dark retro handheld / Game Boy / CRT atmosphere.
- Warm lime accent used sparingly; avoid loud gradients and clutter.
- Subtle expressive pet idle animation, with reduced-motion support.
- Compact, readable pet identity and status information.

## Main gameplay
- Board-first screen; chessboard is the visual centre.
- Responsive, touch-friendly board and controls.
- Clear selected-square, legal-move, check and last-move feedback.
- Small unobtrusive controls for new game, undo, board flip and promotion.
- No oversized buttons, dashboard cards or unnecessary page scrolling.
- Keep scrolling inside contained drawers, panels and dialogs only when necessary.

## Pet and player-save interactions
- Hamburger drawer slides/swipes in from the left; pet personality appears prominently at the top.
- Pet renaming and one complete `.chelo` import/export containing the player and all owned pets.
- Pet collection/switching should remain compact and must not turn the main screen into a dashboard.
- Move history/replay may be added if it fits without crowding gameplay.
- Learning, storage, memories and progression details belong in contained panels.
- Growth, Mastery and Arena Rank remain distinct concepts.
- Personality should be expressed through actual pet behaviour, not just a decorative label.

## Header direction
- Left: hamburger button followed by “Chelo”.
- Right: heart link to `https://prasannaone.github.io/`, share control, and overflow menu for Settings, About and technical options.

## Explicit exclusions / safeguards
- No self-play or Practice Mode assumption; omit unless explicitly reinstated.
- Do not copy the old V5 dashboard layout or old progression/monetisation assumptions.
- Do not use the old 200-Elo premise or fixed material mutation concept.
- Do not reintroduce individual `.soul` export files.
- Maintain accessibility, keyboard support where applicable, and smooth performance on mobile devices.

This checklist is reference material only. M4 is a save/learning milestone, not a UI redesign.
