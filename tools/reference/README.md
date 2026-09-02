# Reference match logs

Captured with `ExportMatchHistory('label')` from the browser console. These are
behavioural baselines: play the same opening the same way after a risky change
and diff, to catch rule drift that the smoke harness's fixed steps can't.

```bash
# replay a log through the engine and check it reproduces
node tools/replay-matchlog.js tools/reference/default-opening-annihilation.a2.json

# or diff two captures of the same opening
node tools/compare-matchlog.js tools/reference/default-opening.a2.json after.json
```

Replay is the stronger test: it re-submits every player action through real
validation and dispatch, and requires the server-decided consequences (ZoC
blasts, turn-start healing, movement hits) to regenerate on their own. That is
how the ZoC suppression bug was found.

Silence means identical. Any output is either a real rules change or a mistake,
and it names the ledger entry to start from.

---

## `default-opening.a2.json`

Burn's "default" opening. Captured 2026-09-02, build `InDev B30`, **after** Track
A2's validation work — so it locks in current behaviour for comparison against
Track C and later, rather than proving A2 changed nothing.

| | |
|---|---|
| Scenario | local multiplayer, radius 3, fog **off** |
| Base camps | P1 `-2,-1_-1,-2`, P2 `1,2_2,1` |
| Length | 3 turns, 33 ledger entries |
| Ends | P1 Melee killed; 7 units left; supply P1 4 / P2 6 |

**Verified internally consistent:** replaying every HP change the ledger claims
lands exactly on the final board for all 7 survivors, and the one killed unit is
absent. The ledger and the state it describes agree.

### What it covers

`MOVE` · `ATTACK` (melee, archer, advantage and disadvantage modifiers, one kill)
· `FORTIFY` · `FORTIFY_ZOC_BLAST` · `TURN_START_ZOC`

### What it does NOT cover

This is the important part — a green diff on this file does **not** mean nothing
broke. Untouched by this opening:

- `BUILD_BRIDGE`, bridge-as-attack-target
- Class swap, respawn / spawn
- Siege status
- Arcade time-limit victory
- Fog of war (all three captured with it **off**)
- Arcade mode, singleplayer vs AI, map maker

Covered by the other two logs in this folder: unfortify, upgrades, mountain
attrition, healing, flag capture, annihilation.

## `default-opening-flag-capture.a2.json`

Same opening, ending in a capture-the-flag win. 11 turns, 32 entries.

Adds coverage for: **mountain fortify** (Archer on a peak, with
`TURN_START_MOUNTAIN_ATTRITION` bleeding it each turn), **unfortify**, and a
**flag capture victory**.

Two things this log exposed rather than covered:

- **Flag events are not in the ledger.** There is no entry for the pickup on
  turn 6 or the capture on turn 11 - both are plain `MOVE`s. The only evidence
  the flag changed hands is `supplyPoints.player1: 0` and `gameOver: true` in
  the outcome block. A6's match archive would not be able to tell a flag win
  from a unit wandering home.
- **Victory is client-driven.** `CheckVictoryCondition` is called only from the
  client wrappers, never from the server. `replay-matchlog.js` mirrors that
  call, or a replayed flag capture never ends.

### Worth capturing next

Three more openings would close most of that gap:

1. **Fog on** — the same opening with fog of war enabled. None of the three
   current logs exercise it, and it gates what the server may send.
2. **Engineering** — bridge building, a bridge destroyed by attack, supply
   lines cut and restored. `BUILD_BRIDGE` is the last unexercised action.
3. **Respawn** — play past a death to a respawn choice, covering spawn-unit and
   the respawn queue.

Capture each twice on different days; if two captures of the *same* opening
diverge, the opening isn't deterministic enough to be a reference and needs a
tighter script.
