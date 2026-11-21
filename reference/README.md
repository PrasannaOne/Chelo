# Chelo Reference Folder

`CHELO-GAME-PLAN.md` is the canonical product/architecture direction. `CHELO-SAVE-FORMAT.md` defines the single `.chelo` portable player save. `ENGINEERING-ROADMAP.md` records milestone status and backend-first priorities. `UI-REFERENCE-CHECKLIST.md` retains historical UI inspiration only.

Preserve the separation between shared C++/V37 chess capability, trainer-specific Bond, battle-derived Arena, personality/memories and the player's one portable `.chelo` file. Engine upgrades must not silently mutate the V37 model or save contract.
