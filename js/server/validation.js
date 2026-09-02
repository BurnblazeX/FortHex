// === Action validation (A2 §3, §4) ===
//
// Everything a client asks for passes through here before any state changes.
// The governing rule: a payload carries IDS AND KEYS ONLY. It says *what* the
// player wants to act on, never the data describing the current state of that
// thing. We resolve those ids fresh against engine.state and use only what we
// find. A client claiming `{ unit: { id: 4, hp: 9999 } }` gets unit 4 as the
// server knows it, and the hp claim is simply never read.
//
// ACTION_SPECS below is the contract table: for each action, which fields are
// required, whether it is turn-gated, how its ids resolve, what makes it legal,
// and which Apply* function runs once it passes. ActionManager.SubmitAction
// (js/server/engine.js) is the only caller.
//
// Editor actions (paint-tile, erase-at) deliberately take a lighter path:
// id resolution and payload shape are checked, turn order and rule legality are
// not, because neither means anything in an offline map editor.

// Client-supplied animation durations are a presentation value the server uses
// to time its mutation (the animationsEnabled design from A1). We keep honouring
// them so animation and state stay in sync, but clamp them - an unclamped
// duration is a free "stall the server" lever.
const MAX_ACTION_DURATION_MS = 3000;

// Mirrors the validStats list inside ApplyUnitUpgrade. Checked here so an unknown
// stat is a clean malformed_payload rejection rather than a console.error deep in
// the mutation, which is what it was until the harness started driving every spec.
const UPGRADEABLE_STATS = ['health', 'speed', 'damage', 'defense'];

function ClampDuration(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(n, MAX_ACTION_DURATION_MS);
}

// --- resolvers -------------------------------------------------------------

function ResolveUnit(unitId) {
    if (unitId === undefined || unitId === null) return null;
    return engine.state.units.find(u => u.id === unitId) || null;
}

function ResolveTile(tileKey) {
    if (typeof tileKey !== 'string') return null;
    return engine.state.tiles.get(tileKey) || null;
}

function ResolveEdge(edgeKey) {
    if (typeof edgeKey !== 'string') return null;
    return engine.state.edges.get(edgeKey) || null;
}

function ResolveUnitType(typeName) {
    if (typeof typeName !== 'string') return null;
    return UNIT_TYPES[typeName.toUpperCase()] || null;
}

// --- shared checks ---------------------------------------------------------

function RequireFields(payload, fields) {
    for (const f of fields) {
        if (payload[f] === undefined || payload[f] === null) {
            return 'missing ' + f;
        }
    }
    return null;
}

// A unit may only be commanded by the player whose turn it is, and only if it
// is theirs. Both halves matter: the first stops out-of-turn play, the second
// stops a player moving the opponent's units on their own turn.
function CheckUnitOwnership(unit) {
    if (unit.player !== engine.state.currentPlayer) return 'not_your_turn';
    return null;
}

function IsTargetInMoveSet(unit, targetEdgeKey) {
    const legal = getPossibleMoves(unit);
    return legal.has(targetEdgeKey) ? legal.get(targetEdgeKey) : null;
}

// --- the contract table ----------------------------------------------------

const ACTION_SPECS = {
    'move': {
        turnGated: true,
        required: ['unitId', 'targetEdgeKey'],
        Resolve(payload) {
            const unit = ResolveUnit(payload.unitId);
            if (!unit) return { error: 'unit_not_found' };
            if (!ResolveEdge(payload.targetEdgeKey)) return { error: 'edge_not_found' };

            const own = CheckUnitOwnership(unit);
            if (own) return { error: own };

            // Legality AND the move's real cost/path come from the server's own
            // move generation. The client used to send both; they are now
            // recomputed, so a client cannot invent a cheap path.
            const move = IsTargetInMoveSet(unit, payload.targetEdgeKey);
            if (!move) return { error: 'illegal_action', detail: 'destination not in legal move set' };

            return { resolved: { unit, targetEdgeKey: payload.targetEdgeKey, cost: move.cost, path: move.path } };
        },
        Apply: (r) => ApplyMoveAction(r.unit, r.targetEdgeKey, r.cost, r.path),
    },

    'attack': {
        turnGated: true,
        required: ['unitId', 'attackType'],
        Resolve(payload) {
            const unit = ResolveUnit(payload.unitId);
            if (!unit) return { error: 'unit_not_found' };

            const own = CheckUnitOwnership(unit);
            if (own) return { error: own };

            // The server picks the target descriptor out of its OWN computed
            // valid-target set. The client only names which one it chose, so it
            // cannot invent a target or describe one it can't actually reach.
            // (Melee returns [] for archers and vice versa, so the union is safe.)
            const valid = getValidMeleeAttackTargets(unit).concat(getValidArcherAttackTargets(unit));

            let entry;
            if (payload.isBridgeTarget) {
                if (typeof payload.targetEdgeKey !== 'string') {
                    return { error: 'malformed_payload', detail: 'missing targetEdgeKey' };
                }
                entry = valid.find(t => t.isBridgeTarget && t.edgeKey === payload.targetEdgeKey);
                if (!entry) return { error: 'illegal_action', detail: 'bridge not a valid target' };
            } else {
                if (payload.targetUnitId === undefined || payload.targetUnitId === null) {
                    return { error: 'malformed_payload', detail: 'missing targetUnitId' };
                }
                if (!ResolveUnit(payload.targetUnitId)) return { error: 'unit_not_found', detail: 'target' };
                entry = valid.find(t => t.unit && t.unit.id === payload.targetUnitId);
                if (!entry) return { error: 'illegal_action', detail: 'target out of range' };
            }

            return {
                resolved: {
                    unit,
                    targetUnitInfo: entry,
                    attackType: payload.attackType,
                    duration: ClampDuration(payload.duration, 250),
                }
            };
        },
        Apply: (r) => ApplyAttack(r.unit, r.targetUnitInfo, r.attackType, r.duration),
    },

    'fortify': {
        turnGated: true,
        required: ['unitId', 'targetTileKey'],
        Resolve(payload) {
            const unit = ResolveUnit(payload.unitId);
            if (!unit) return { error: 'unit_not_found' };
            if (!ResolveTile(payload.targetTileKey)) return { error: 'tile_not_found' };

            const own = CheckUnitOwnership(unit);
            if (own) return { error: own };
            if (!GetValidFortifyTargets(unit).includes(payload.targetTileKey)) {
                return { error: 'illegal_action', detail: 'unit cannot fortify there' };
            }

            return { resolved: { unit, targetTileKey: payload.targetTileKey, duration: ClampDuration(payload.duration, 450) } };
        },
        Apply: (r) => ApplyFortify(r.unit, r.targetTileKey, r.duration),
    },

    'unfortify': {
        turnGated: true,
        required: ['unitId', 'targetEdgeKey'],
        Resolve(payload) {
            const unit = ResolveUnit(payload.unitId);
            if (!unit) return { error: 'unit_not_found' };
            if (!ResolveEdge(payload.targetEdgeKey)) return { error: 'edge_not_found' };

            const own = CheckUnitOwnership(unit);
            if (own) return { error: own };
            if (!unit.isFortified) return { error: 'illegal_action', detail: 'unit is not fortified' };

            const targets = getPotentialUnfortifyTargets(unit);
            if (!targets.includes(payload.targetEdgeKey)) {
                return { error: 'illegal_action', detail: 'edge not an unfortify target' };
            }

            return { resolved: { unit, targetEdgeKey: payload.targetEdgeKey, duration: ClampDuration(payload.duration, 600) } };
        },
        Apply: (r) => ApplyUnfortify(r.unit, r.targetEdgeKey, r.duration),
    },

    'build-bridge': {
        turnGated: true,
        required: ['unitId', 'targetEdgeKey'],
        Resolve(payload) {
            const unit = ResolveUnit(payload.unitId);
            if (!unit) return { error: 'unit_not_found' };
            if (!ResolveEdge(payload.targetEdgeKey)) return { error: 'edge_not_found' };

            const own = CheckUnitOwnership(unit);
            if (own) return { error: own };

            const targets = getPotentialBridgeTargets(unit);
            if (!targets.includes(payload.targetEdgeKey)) {
                return { error: 'illegal_action', detail: 'edge not a bridge target' };
            }

            return { resolved: { unit, targetEdgeKey: payload.targetEdgeKey, duration: ClampDuration(payload.duration, 500) } };
        },
        Apply: (r) => ApplyBuildBridge(r.unit, r.targetEdgeKey, r.duration),
    },

    'upgrade-unit': {
        turnGated: true,
        required: ['unitId', 'statType'],
        Resolve(payload) {
            const unit = ResolveUnit(payload.unitId);
            if (!unit) return { error: 'unit_not_found' };

            const own = CheckUnitOwnership(unit);
            if (own) return { error: own };
            if (unit.level >= UPGRADE_CONSTANTS.MAX_LEVEL) {
                return { error: 'illegal_action', detail: 'unit at max level' };
            }
            if (!UPGRADEABLE_STATS.includes(payload.statType)) {
                return { error: 'malformed_payload', detail: 'unknown stat type' };
            }

            return { resolved: { unit, statType: payload.statType } };
        },
        Apply: (r) => ApplyUnitUpgrade(r.unit, r.statType),
    },

    'swap-class': {
        turnGated: true,
        required: ['unitId', 'newTypeName'],
        Resolve(payload) {
            const unit = ResolveUnit(payload.unitId);
            if (!unit) return { error: 'unit_not_found' };

            const own = CheckUnitOwnership(unit);
            if (own) return { error: own };

            const newType = ResolveUnitType(payload.newTypeName);
            if (!newType) return { error: 'illegal_action', detail: 'unknown unit type' };
            if (unit.isFortified && newType.defense <= 0) {
                return { error: 'illegal_action', detail: 'fortified unit needs a defending class' };
            }

            return { resolved: { unit, newType } };
        },
        Apply: (r) => ApplyClassSwap(r.unit, r.newType),
    },

    'spawn-unit': {
        turnGated: true,
        required: ['player', 'unitTypeName'],
        Resolve(payload) {
            if (payload.player !== engine.state.currentPlayer) return { error: 'not_your_turn' };

            const unitType = ResolveUnitType(payload.unitTypeName);
            if (!unitType) return { error: 'illegal_action', detail: 'unknown unit type' };

            const counts = getUnitCountsForPlayer(payload.player);
            if (counts[unitType.name] >= UNIT_CAPS[unitType.name]) {
                return { error: 'illegal_action', detail: 'unit cap reached' };
            }

            return { resolved: { player: payload.player, unitType } };
        },
        Apply: (r) => SpawnUnit(r.player, r.unitType),
    },

    'end-turn': {
        turnGated: false, // ending your own turn is always in-turn by definition
        required: [],
        Resolve() {
            return { resolved: {} };
        },
        Apply: () => AdvanceTurn(),
    },

    // --- session actions: not turn-gated, and deliberately so (A3) ----------

    // Prompts the server to look at its own clock. Carries nothing: a client
    // that reported elapsed time would be a client deciding when it wins the
    // wait. Provisional until Track B can push without being asked — see the
    // note on CheckDisconnectDeadlines.
    'heartbeat': {
        turnGated: false,
        required: [],
        Resolve() {
            return { resolved: {} };
        },
        Apply: () => CheckDisconnectDeadlines(),
    },

    // The present player's answer to "your opponent didn't come back". Must NOT
    // be turn-gated: by the time it's asked, the turn has usually cycled to the
    // absent player, so gating it on the current turn would make it impossible
    // to submit at exactly the moment it's needed.
    'resolve-disconnect': {
        turnGated: false,
        required: ['player', 'choice'],
        Resolve(payload) {
            // Requester identity comes off the payload because nothing carries
            // it yet — same shape as spawn-unit's `player`. Track B replaces
            // this with the identity of the connection the message arrived on;
            // until then a single local client is the only sender there is.
            if (payload.player !== 1 && payload.player !== 2) {
                return { error: 'malformed_payload', detail: 'player must be 1 or 2' };
            }
            if (!DISCONNECT_RESOLUTIONS.includes(payload.choice)) {
                return { error: 'malformed_payload', detail: 'unknown resolution choice' };
            }

            const absentPlayer = FindPlayerAwaitingResolution();
            if (absentPlayer === null) {
                return { error: 'illegal_action', detail: 'no resolution pending' };
            }

            // Only the player who stayed gets to decide. The absent one is by
            // definition not the one asking.
            if (absentPlayer === payload.player) {
                return { error: 'illegal_action', detail: 'requester is the absent player' };
            }
            const requesterSession = GetPlayerSession(payload.player);
            if (!requesterSession || !requesterSession.connected) {
                return { error: 'illegal_action', detail: 'requester is not connected' };
            }

            return { resolved: { requester: payload.player, absentPlayer, choice: payload.choice } };
        },
        Apply: (r) => ApplyDisconnectResolution(r.requester, r.absentPlayer, r.choice),
    },

    // --- editor actions: lighter path, same protocol shape (A2 §8) ----------
    // Shape and id resolution are checked. Turn order and rule legality are not,
    // because a map editor has neither turns nor gameplay rules.

    'paint-tile': {
        turnGated: false,
        editor: true,
        required: ['tileKey', 'tileTypeName'],
        Resolve(payload) {
            const tile = ResolveTile(payload.tileKey);
            if (!tile) return { error: 'tile_not_found' };

            const tileType = TILE_TYPES[String(payload.tileTypeName).toUpperCase()];
            if (!tileType) return { error: 'malformed_payload', detail: 'unknown tile type' };

            return { resolved: { tileKey: payload.tileKey, tileType } };
        },
        Apply: (r) => PaintTile(r.tileKey, r.tileType),
    },

    'flood-fill': {
        turnGated: false,
        editor: true,
        required: ['startQ', 'startR', 'tileTypeName'],
        Resolve(payload) {
            const tileType = TILE_TYPES[String(payload.tileTypeName).toUpperCase()];
            if (!tileType) return { error: 'malformed_payload', detail: 'unknown tile type' };

            return { resolved: { startQ: payload.startQ, startR: payload.startR, tileType } };
        },
        Apply: (r) => PerformFloodFill(r.startQ, r.startR, r.tileType),
    },

    'erase-tile': {
        turnGated: false,
        editor: true,
        required: ['tileKey'],
        Resolve(payload) {
            const tile = ResolveTile(payload.tileKey);
            if (!tile) return { error: 'tile_not_found' };
            return { resolved: { tileKey: payload.tileKey } };
        },
        Apply: (r) => EraseTile(r.tileKey),
    },

    'remove-unit': {
        turnGated: false,
        editor: true,
        required: ['unitId'],
        Resolve(payload) {
            const unit = ResolveUnit(payload.unitId);
            if (!unit) return { error: 'unit_not_found' };
            return { resolved: { unitId: payload.unitId } };
        },
        Apply: (r) => RemoveUnitFromEditor(r.unitId),
    },

    'set-base-camp-rotation': {
        turnGated: false,
        editor: true,
        required: ['rotation'],
        Resolve(payload) {
            const n = parseInt(payload.rotation, 10);
            if (!Number.isInteger(n) || n < 0 || n > 5) {
                return { error: 'malformed_payload', detail: 'rotation must be 0-5' };
            }
            return { resolved: { rotation: payload.rotation } };
        },
        Apply: (r) => ({ changed: UpdateBaseCampLocations(r.rotation) }),
    },

    'clear-map': {
        turnGated: false,
        editor: true,
        required: [],
        Resolve(payload) {
            return { resolved: { baseCampRotation: payload.baseCampRotation } };
        },
        Apply: (r) => ClearMapForEditor(r.baseCampRotation),
    },

    'toggle-base-camp': {
        turnGated: false,
        editor: true,
        required: ['player', 'tileKey'],
        Resolve(payload) {
            if (!ResolveTile(payload.tileKey)) return { error: 'tile_not_found' };
            return { resolved: { player: payload.player, tileKey: payload.tileKey } };
        },
        Apply: (r) => ToggleBaseCampTile(r.player, r.tileKey),
    },

    'place-unit': {
        turnGated: false,
        editor: true,
        required: ['player', 'unitTypeName', 'edgeKey'],
        Resolve(payload) {
            if (!ResolveEdge(payload.edgeKey)) return { error: 'edge_not_found' };

            const unitType = ResolveUnitType(payload.unitTypeName);
            if (!unitType) return { error: 'malformed_payload', detail: 'unknown unit type' };

            return { resolved: { player: payload.player, unitType, edgeKey: payload.edgeKey } };
        },
        Apply: (r) => PlaceUnitInEditor(r.player, r.unitType, r.edgeKey),
    },
};

// --- the entry point -------------------------------------------------------

function ValidateAction(spec, message) {
    const payload = message.payload;
    if (!payload || typeof payload !== 'object') {
        return { ok: false, error: 'malformed_payload', detail: 'payload is not an object' };
    }

    const missing = RequireFields(payload, spec.required);
    if (missing) {
        return { ok: false, error: 'malformed_payload', detail: missing };
    }

    if (spec.turnGated && engine.state.gameOver) {
        return { ok: false, error: 'illegal_action', detail: 'match is over' };
    }

    const outcome = spec.Resolve(payload);
    if (outcome.error) {
        return { ok: false, error: outcome.error, detail: outcome.detail || null };
    }

    return { ok: true, resolved: outcome.resolved };
}
