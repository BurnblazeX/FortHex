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

- `UNFORTIFY`, `BUILD_BRIDGE`, bridge-as-attack-target
- Unit upgrade, class swap, respawn / spawn
- Flag pickup, capture, return; supply-line severing
- Mountain attrition, start-of-turn healing, siege status
- Victory of any kind (annihilation, flag, arcade time limit)
- Fog of war (captured with it **off**)
- Arcade mode, singleplayer vs AI, map maker

### Worth capturing next

Three more openings would close most of that gap:

1. **Combat-heavy, fog on** — same map, fog enabled, run to an annihilation
   victory. Covers fog, healing, respawn, victory.
2. **Engineering** — bridge building, unfortify, a bridge destroyed by attack,
   supply lines cut and restored.
3. **Flag run** — pick up, carry, capture. Covers the flag branches and the
   supply severing that comes with them.

Capture each twice on different days; if two captures of the *same* opening
diverge, the opening isn't deterministic enough to be a reference and needs a
tighter script.
