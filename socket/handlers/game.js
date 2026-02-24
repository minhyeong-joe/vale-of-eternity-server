/**
 * Socket event handlers for all in-game actions.
 * Every handler validates state before mutating.
 * On success: broadcast updated state to room.
 * On failure: emit game:error to the requesting socket only.
 */

import { GameEvents, RoomEvents } from "../contracts.js";
import { getRoom, updateRoom, toRoomInfo } from "../store/rooms.js";
import { CardEffectRepo } from "../effects/repo.js";
import {
	createGame,
	getGame,
	deleteGame,
	getPlayer,
	getPlayerIndex,
	toClientState,
	summonCard,
	discardFromHand,
	discardFromArea,
	recoverCard,
	earnStones,
	discardStones,
	earnScore,
	recomputePermanents,
	validatePayment,
	effectiveCost,
	areaLimit,
	playerHasBoardMarkers,
	checkEndGame,
	startActionPhase,
	startResolutionPhase,
	startRound,
	advanceResolutionTurn,
	totalStones,
	stoneCap,
	SELL_REWARDS,
	checkStoneOverflow,
} from "../store/game.js";
import { CardData } from "../effects/cardData.js";
import {
	resolveEffect,
	fireOnSummonTriggers,
	fireOnTameTriggers,
	checkSummonFeasibility,
	getActivatableCards,
	hasResolvableActiveEffect,
} from "../effects/index.js";

// ─── Broadcast helpers ─────────────────────────────────────────────────────

/**
 * Broadcast full personalized game state to each player in the room.
 */
function broadcastState(io, gs) {
	for (const p of gs.players) {
		const state = toClientState(gs, p.userId);
		io.to(p.socketId).emit(GameEvents.STATE, state);
	}
}

/**
 * Broadcast state delta (same personalized logic but tagged as delta).
 * Here we just send the full personalized state for simplicity.
 */
function broadcastDelta(io, gs) {
	broadcastState(io, gs);
}

function gameError(socket, message) {
	socket.emit(GameEvents.ERROR, { message });
}

// ─── game:start ────────────────────────────────────────────────────────────

export function handleGameStart(io, socket) {
	const { userId } = socket.data;
	const room = getRoom(getRoomIdForSocket(io, socket));
	if (!room) return gameError(socket, "Room not found");
	if (room.hostUserId !== userId)
		return gameError(socket, "Only host can start the game");
	if (room.status !== "waiting")
		return gameError(socket, "Game already started");
	if (room.players.length < 2)
		return gameError(socket, "Need at least 2 players");

	room.status = "in-progress";
	const gs = createGame(room.id, room.players);

	broadcastState(io, gs);
	console.log(`[game] Started in room ${room.id} — round ${gs.round}`);
}

// ─── game:hunt-pick ────────────────────────────────────────────────────────

export function handleHuntPick(io, socket, payload) {
	const { userId } = socket.data;
	const gs = getGameForSocket(socket);
	if (!gs) return gameError(socket, "No active game");

	if (gs.phase !== "hunting") return gameError(socket, "Not in hunting phase");

	const activeUserId = gs.players[gs.huntPickOrder[gs.huntPicksDone]]?.userId;
	if (activeUserId !== userId)
		return gameError(socket, "Not your turn to hunt");

	const { cardId } = payload ?? {};
	if (!cardId) return gameError(socket, "cardId required");

	// Validate: card is on board and unclaimed
	const allBoardCards = Object.values(gs.boardZones).flat();
	if (!allBoardCards.includes(cardId))
		return gameError(socket, "Card not on board");
	if (gs.boardMarkers[cardId]) return gameError(socket, "Card already claimed");

	// Place marker
	gs.boardMarkers[cardId] = userId;
	gs.huntPicksDone += 1;

	// Check if all picks done
	const totalPicks = gs.huntPickOrder.length;
	if (gs.huntPicksDone >= totalPicks) {
		// All markers placed — begin action phase
		startActionPhase(gs);
	}

	broadcastDelta(io, gs);
}

// ─── game:sell ─────────────────────────────────────────────────────────────

export function handleSell(io, socket, payload) {
	const { userId } = socket.data;
	const gs = getGameForSocket(socket);
	if (!gs) return gameError(socket, "No active game");
	if (gs.phase !== "action") return gameError(socket, "Not in action phase");
	if (gs.players[gs.activePlayerIndex]?.userId !== userId)
		return gameError(socket, "Not your turn");

	const { cardId } = payload ?? {};
	if (!cardId) return gameError(socket, "cardId required");

	// Validate player has marker on this card
	if (gs.boardMarkers[cardId] !== userId)
		return gameError(socket, "No marker on this card");

	const card = CardData[cardId];
	if (!card) return gameError(socket, "Invalid card");

	const player = getPlayer(gs, userId);

	// Remove marker
	delete gs.boardMarkers[cardId];

	// Remove card from board zone
	const zone = gs.boardZones[card.family];
	const idx = zone.indexOf(cardId);
	if (idx !== -1) zone.splice(idx, 1);

	// Add to discard
	gs.discardPile.push(cardId);

	// Grant sell reward
	const reward = SELL_REWARDS[card.family];
	if (reward.red) earnStones(player, "red", reward.red);
	if (reward.blue) earnStones(player, "blue", reward.blue);
	if (reward.purple) earnStones(player, "purple", reward.purple);

	checkStoneOverflow(gs, userId);
	broadcastDelta(io, gs);
	if (gs.pendingInteraction) {
		io.to(player.socketId).emit(GameEvents.INTERACTION, gs.pendingInteraction);
	}
}

// ─── game:tame ─────────────────────────────────────────────────────────────

export function handleTame(io, socket, payload) {
	const { userId } = socket.data;
	const gs = getGameForSocket(socket);
	if (!gs) return gameError(socket, "No active game");
	if (gs.phase !== "action") return gameError(socket, "Not in action phase");
	if (gs.players[gs.activePlayerIndex]?.userId !== userId)
		return gameError(socket, "Not your turn");

	const { cardId } = payload ?? {};
	if (!cardId) return gameError(socket, "cardId required");

	if (gs.boardMarkers[cardId] !== userId)
		return gameError(socket, "No marker on this card");

	const card = CardData[cardId];
	if (!card) return gameError(socket, "Invalid card");

	const player = getPlayer(gs, userId);

	// Remove marker
	delete gs.boardMarkers[cardId];

	// Remove from board zone
	const zone = gs.boardZones[card.family];
	const idx = zone.indexOf(cardId);
	if (idx !== -1) zone.splice(idx, 1);

	// Add to hand
	player.hand.push(cardId);

	// Fire onTame permanent triggers
	fireOnTameTriggers(gs, player, cardId);

	broadcastDelta(io, gs);
}

// ─── game:summon ───────────────────────────────────────────────────────────

export function handleSummon(io, socket, payload) {
	const { userId } = socket.data;
	const gs = getGameForSocket(socket);
	if (!gs) return gameError(socket, "No active game");
	if (gs.phase !== "action") return gameError(socket, "Not in action phase");
	if (gs.players[gs.activePlayerIndex]?.userId !== userId)
		return gameError(socket, "Not your turn");

	const { cardId, payment } = payload ?? {};
	if (!cardId || !payment)
		return gameError(socket, "cardId and payment required");

	const player = getPlayer(gs, userId);
	if (!player.hand.includes(cardId))
		return gameError(socket, "Card not in hand");

	// Area limit
	if (player.area.length >= areaLimit(gs)) {
		return gameError(
			socket,
			`Area full — remove a card first (limit: ${areaLimit(gs)})`,
		);
	}

	// Payment validation
	const payResult = validatePayment(player, cardId, payment);
	if (!payResult.ok) return gameError(socket, payResult.error);

	// Pre-check instant effect feasibility (Ember etc.)
	const feasibility = checkSummonFeasibility(gs, player, cardId);
	if (!feasibility.ok) return gameError(socket, feasibility.error);

	// Move card hand → area and deduct payment
	summonCard(gs, player, cardId, payment);
	recomputePermanents(player);

	// Fire instant effect
	const def = CardEffectRepo[cardId];
	if (def) {
		const iIdx = def.effects.findIndex((e) => e.type === "instant");
		if (iIdx !== -1) {
			const result = resolveEffect(gs, userId, cardId, iIdx, { payment });
			if (!result.ok && !result.needsInteraction) {
				return gameError(socket, result.error);
			}
		}
	}

	// Fire onSummon permanent triggers from other cards in area
	fireOnSummonTriggers(gs, player, cardId, payment);

	checkStoneOverflow(gs, userId);
	broadcastDelta(io, gs);

	// If pending interaction, notify the target player
	if (gs.pendingInteraction) {
		const forPlayer = getPlayer(gs, gs.pendingInteraction.forUserId);
		if (forPlayer) {
			io.to(forPlayer.socketId).emit(
				GameEvents.INTERACTION,
				gs.pendingInteraction,
			);
		}
	}
}

// ─── game:remove ───────────────────────────────────────────────────────────

export function handleRemove(io, socket, payload) {
	const { userId } = socket.data;
	const gs = getGameForSocket(socket);
	if (!gs) return gameError(socket, "No active game");
	if (gs.phase !== "action") return gameError(socket, "Not in action phase");
	if (gs.players[gs.activePlayerIndex]?.userId !== userId)
		return gameError(socket, "Not your turn");

	const { cardId } = payload ?? {};
	if (!cardId) return gameError(socket, "cardId required");

	const player = getPlayer(gs, userId);
	if (!player.area.includes(cardId))
		return gameError(socket, "Card not in your area");

	// Remove costs: stone value ≥ current round number
	const removeCost = gs.round;
	const playerStoneValue =
		player.stones.red + player.stones.blue * 3 + player.stones.purple * 6;
	if (playerStoneValue < removeCost) {
		return gameError(
			socket,
			`Remove costs ${removeCost} stone value. You only have ${playerStoneValue}`,
		);
	}

	// Deduct stones (cheapest first is auto-handled; but actual stone removal needs player choice in strict rules)
	// For simplicity: auto-deduct cheapest first
	let remaining = removeCost;
	while (remaining > 0) {
		if (player.stones.red > 0 && remaining >= 1) {
			player.stones.red--;
			remaining -= 1;
		} else if (player.stones.blue > 0 && remaining >= 3) {
			player.stones.blue--;
			remaining -= 3;
		} else if (player.stones.blue > 0) {
			player.stones.blue--;
			remaining -= 3;
		} // overpay
		else if (player.stones.purple > 0) {
			player.stones.purple--;
			remaining -= 6;
		} // overpay
		else break;
	}

	discardFromArea(gs, player, cardId);
	recomputePermanents(player);

	broadcastDelta(io, gs);
}

// ─── game:activate ─────────────────────────────────────────────────────────

export function handleActivate(io, socket, payload) {
	const { userId } = socket.data;
	const gs = getGameForSocket(socket);
	if (!gs) return gameError(socket, "No active game");
	if (gs.phase !== "resolution")
		return gameError(socket, "Not in resolution phase");
	if (gs.players[gs.activePlayerIndex]?.userId !== userId)
		return gameError(socket, "Not your resolution turn");

	const { cardId } = payload ?? {};
	if (!cardId) return gameError(socket, "cardId required");

	const player = getPlayer(gs, userId);
	if (!player.area.includes(cardId))
		return gameError(socket, "Card not in your area");
	if (player.activeEffectsUsed.includes(cardId))
		return gameError(socket, "Already activated this round");

	const def = CardEffectRepo[cardId];
	if (!def) return gameError(socket, "No effect definition");
	const eIdx = def.effects.findIndex((e) => e.type === "active");
	if (eIdx === -1) return gameError(socket, "Card has no active effect");

	const result = resolveEffect(gs, userId, cardId, eIdx, null);
	if (!result.ok && !result.needsInteraction) {
		return gameError(socket, result.error ?? "Effect failed");
	}

	if (!result.needsInteraction) {
		player.activeEffectsUsed.push(cardId);
	}

	checkStoneOverflow(gs, userId);
	broadcastDelta(io, gs);

	if (gs.pendingInteraction) {
		const forPlayer = getPlayer(gs, gs.pendingInteraction.forUserId);
		if (forPlayer) {
			io.to(forPlayer.socketId).emit(
				GameEvents.INTERACTION,
				gs.pendingInteraction,
			);
		}
	}
}

// ─── game:respond ──────────────────────────────────────────────────────────

export function handleRespond(io, socket, payload) {
	const { userId } = socket.data;
	const gs = getGameForSocket(socket);
	if (!gs) return gameError(socket, "No active game");
	if (!gs.pendingInteraction)
		return gameError(socket, "No pending interaction");
	if (gs.pendingInteraction.forUserId !== userId)
		return gameError(socket, "Not your interaction");

	const { cardId, context: pCtx } = gs.pendingInteraction;
	const { type, value } = payload ?? {};

	// Stone overflow: player chooses which stone type to discard
	if (gs.pendingInteraction.type === "stoneOverflow") {
		if (!["red", "blue", "purple"].includes(value)) {
			return gameError(socket, "Invalid stone type to discard");
		}
		const player = getPlayer(gs, userId);
		if (!player || (player.stones[value] ?? 0) < 1) {
			return gameError(socket, `No ${value} stone to discard`);
		}
		player.stones[value]--;
		gs.pendingInteraction = null;
		checkStoneOverflow(gs, userId);
		broadcastDelta(io, gs);
		if (gs.pendingInteraction) {
			io.to(player.socketId).emit(GameEvents.INTERACTION, gs.pendingInteraction);
		}
		return;
	}

	// Build context from pending + response
	const responseContext = buildResponseContext(type, value, pCtx);
	gs.pendingInteraction = null;

	// Re-run the effect with the response context
	const effectingPlayer =
		gs.players.find((p) =>
			pCtx?.actingUserId ? p.userId === pCtx.actingUserId : p.userId === userId,
		) ?? getPlayer(gs, userId);

	const def = CardEffectRepo[cardId];
	if (!def) return gameError(socket, "No effect def for responding card");

	// Find the relevant effect index
	let eIdx = def.effects.findIndex(
		(e) =>
			(gs.phase === "resolution" && e.type === "active") ||
			(gs.phase === "action" && e.type === "instant"),
	);
	if (eIdx === -1) eIdx = 0;

	const result = resolveEffect(
		gs,
		effectingPlayer.userId,
		cardId,
		eIdx,
		responseContext,
	);

	if (!result.ok && !result.needsInteraction) {
		return gameError(socket, result.error ?? "Response failed");
	}

	// Mark active as used if resolution phase and fully done
	if (!result.needsInteraction && gs.phase === "resolution") {
		const effPlayer = getPlayer(gs, effectingPlayer.userId);
		if (effPlayer && !effPlayer.activeEffectsUsed.includes(cardId)) {
			effPlayer.activeEffectsUsed.push(cardId);
		}
	}

	broadcastDelta(io, gs);

	if (gs.pendingInteraction) {
		const forPlayer = getPlayer(gs, gs.pendingInteraction.forUserId);
		if (forPlayer) {
			io.to(forPlayer.socketId).emit(
				GameEvents.INTERACTION,
				gs.pendingInteraction,
			);
		}
	}
}

function buildResponseContext(type, value, pCtx) {
	switch (type) {
		case "target":
			return { ...pCtx, targetUserId: value };
		case "card":
			return { ...pCtx, cardId: value, value };
		case "cards":
			return { ...pCtx, cardIds: value, value };
		case "choice":
			return { ...pCtx, choiceIndex: value };
		case "discardThenSummon":
			return { ...pCtx, value };
		default:
			return { ...pCtx, value };
	}
}

// ─── game:end-turn ─────────────────────────────────────────────────────────

export function handleEndTurn(io, socket) {
	const { userId } = socket.data;
	const gs = getGameForSocket(socket);
	if (!gs) return gameError(socket, "No active game");
	if (gs.players[gs.activePlayerIndex]?.userId !== userId)
		return gameError(socket, "Not your turn");

	if (gs.phase === "action") {
		// Rule: cannot end turn if any markers remain on board
		if (playerHasBoardMarkers(gs, userId)) {
			return gameError(
				socket,
				"Must sell or tame all your board cards before ending turn",
			);
		}

		// Advance to next player
		const n = gs.players.length;
		const next = (gs.activePlayerIndex + 1) % n;
		gs.activePlayerIndex = next;

		// If we've gone all the way around, start resolution
		if (next === gs.firstPlayerIndex) {
			startResolutionPhase(gs);
		}

		broadcastDelta(io, gs);
		return;
	}

	if (gs.phase === "resolution") {
		// Rule: cannot end resolution turn if resolvable active effects remain
		const player = getPlayer(gs, userId);
		if (hasResolvableActiveEffect(gs, player)) {
			return gameError(
				socket,
				"Must activate all available active effects before ending turn",
			);
		}

		// Advance to next player, auto-skipping those with no resolvable active effects
		const n = gs.players.length;
		let roundDone = false;
		for (let i = 0; i < n; i++) {
			const next = (gs.activePlayerIndex + 1) % n;
			gs.activePlayerIndex = next;
			if (next === gs.firstPlayerIndex) {
				roundDone = true;
				break;
			}
			if (hasResolvableActiveEffect(gs, gs.players[next])) break;
		}

		if (roundDone) {
			endRound(io, gs);
		} else {
			broadcastDelta(io, gs);
		}
		return;
	}

	gameError(socket, "Cannot end turn in this phase");
}


function endRound(io, gs) {
	if (checkEndGame(gs)) {
		gs.phase = "finished";
		broadcastState(io, gs);
		// Update room status
		const room = getRoom(gs.roomId);
		if (room) room.status = "finished";
		console.log(`[game] Game over in room ${gs.roomId}`);
		return;
	}
	// Start next round
	startRound(gs);
	broadcastState(io, gs);
	console.log(`[game] Room ${gs.roomId} — round ${gs.round} started`);
}

// ─── Helper: find game state for a socket ────────────────────────────────

function getRoomIdForSocket(io, socket) {
	// Sockets rooms include the socket's own ID + rooms they've joined
	const rooms = [...socket.rooms].filter((r) => r !== socket.id);
	return rooms[0] ?? null;
}

function getGameForSocket(socket) {
	const roomId = getRoomIdForSocket(null, socket);
	return roomId ? getGame(roomId) : null;
}

// Override to pass io for rooms lookup
export function getGameForSocketWithIo(io, socket) {
	const roomId = getRoomIdForSocket(io, socket);
	return roomId ? getGame(roomId) : null;
}
