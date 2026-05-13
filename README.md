# Halls of the Forgotten

A playable browser roguelike based on exemplar #1 in `domecs/doc/exemplars.md`.

## Features

- 128×128 deterministic procedural dungeon levels with a 48×32 rendered viewport.
- Strictly turn-based simulation: monsters, hunger, status effects, and FOV advance only after player actions.
- Field-of-view and exploration memory; unrendered off-screen cells stay in the save but not in the DOM.
- Inventory modal, hover tooltips, bump combat, equipment, hunger, poison/stealth/sleep effects.
- Identification game for potions and scrolls.
- Permadeath with meta-progression: echo shards bank after death/escape and grant future max-HP bonuses.
- Save/load/export as a single JSON blob containing the map, RNG state, actors, items, inventory, and discoveries.

## Run

This is a no-build static ES module app.

```sh
# from ./halls_game
python3 -m http.server 4173
# open http://localhost:4173
```

## Test

```sh
npm test
```

The tests exercise deterministic generation, 128×128 scale, FOV limits, turn-based mutation, and snapshot/restore.

## Controls

- Arrow keys, WASD, or HJKL: move / bump attack
- `.` or Space: wait
- `g`: pick up
- `i`: inventory
- `>`: descend stairs
- `?`: help
