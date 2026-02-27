/**
 * Socket event handlers for all in-game actions.
 * Every handler validates state before mutating.
 * On success: broadcast updated state to room.
 * On failure: emit game:error to the requesting socket only.
 */

import { GameEvents, RoomEvents } from "../contracts.js";
import { getRoom, toRoomDetail } from "../store/rooms.js";
import { CardEffectRepo } from "../effects/repo.js";
import {
	createGame,
	getGame,
	deleteGame,
	getPlayer,
	toClientState,
	summonCard,
	discardFromArea,
	earnStones,
	recomputePermanents,
	validatePayment,
	areaLimit,
	playerHasBoardMarkers,
	checkEndGame,
	startActionPhase,
	startResolutionPhase,
	startRound,
	SELL_REWARDS,
	checkStoneOverflow,
	stoneValue,
} from "../store/game.js";
import { CardData } from "../effects/cardData.js";
import {
	resolveEffect,
	fireOnSummonTriggers,
	fireOnTameTriggers,
	checkSummonFeasibility,
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

function emitInteractionIfPending(io, gs) {
	if (!gs.pendingInteraction) return;
	const forPlayer = getPlayer(gs, gs.pendingInteraction.forUserId);
	if (!forPlayer) return;
	io.to(forPlayer.socketId).emit(GameEvents.INTERACTION, gs.pendingInteraction);
	io.to(gs.roomId).emit(GameEvents.ACTION, {
		action: "interaction",
		userId: forPlayer.userId,
		username: forPlayer.username,
		cardId: gs.pendingInteraction.cardId,
		interactionType: gs.pendingInteraction.type,
	});
}

// ─── game:start ────────────────────────────────────────────────────────────

export function handleGameStart(io, socket) {
	const { userId } = socket.data;
	const room = getRoom(getRoomIdForSocket(io, socket));
	if (!room) return gameError(socket, "Room not found");
	if (room.hostUserId !== userId)
		return gameError(socket, "Only host can start the game");
	if (room.status !== "waiting" && room.status !== "finished")
		return gameError(socket, "Game already started");
	if (room.players.length < 2)
		return gameError(socket, "Need at least 2 players");
	if (room.players.some((p) => !p.isReady))
		return gameError(socket, "Not all players are ready");

	deleteGame(room.id);
	room.status = "in-progress";
	room.players.forEach((p) => {
		if (p.userId !== room.hostUserId) {
			p.isReady = false;
		}
	});
	const gs = createGame(room.id, room.players);

	broadcastState(io, gs);
	io.to(room.id).emit(RoomEvents.UPDATED, { roomDetail: toRoomDetail(room) });
	io.to(room.id).emit(GameEvents.ACTION, {
		action: "start",
		userId,
		username: getPlayer(gs, userId)?.username ?? "",
	});
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
	io.to(gs.roomId).emit(GameEvents.ACTION, {
		action: "hunt-pick",
		userId,
		username: getPlayer(gs, userId)?.username ?? "",
		cardId,
	});
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
	io.to(gs.roomId).emit(GameEvents.ACTION, {
		action: "sell",
		userId,
		username: player.username,
		cardId,
		stonesGained: {
			red: reward.red ?? 0,
			blue: reward.blue ?? 0,
			purple: reward.purple ?? 0,
		},
	});
	emitInteractionIfPending(io, gs);
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
	io.to(gs.roomId).emit(GameEvents.ACTION, {
		action: "tame",
		userId,
		username: player.username,
		cardId,
	});
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
				// State is already committed (card summoned, stones paid) — sync client before erroring
				broadcastDelta(io, gs);
				return gameError(socket, result.error);
			}
		}
	}

	// Fire onSummon permanent triggers from other cards in area
	fireOnSummonTriggers(gs, player, cardId, payment);

	checkStoneOverflow(gs, userId);
	broadcastDelta(io, gs);
	io.to(gs.roomId).emit(GameEvents.ACTION, {
		action: "summon",
		userId,
		username: player.username,
		cardId,
	});
	emitInteractionIfPending(io, gs);
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

	const { payment } = payload ?? {};
	if (!payment) return gameError(socket, "payment required");

	const player = getPlayer(gs, userId);
	if (!player.area.includes(cardId))
		return gameError(socket, "Card not in your area");

	// Remove costs: stone value ≥ current round number
	const removeCost = gs.round;
	const paid =
		stoneValue(player, "red", payment.red ?? 0) +
		stoneValue(player, "blue", payment.blue ?? 0) +
		stoneValue(player, "purple", payment.purple ?? 0);
	if (paid < removeCost) {
		return gameError(
			socket,
			`Remove costs ${removeCost} stone value. You only paid ${paid}`,
		);
	}
	// for each payment stones, check if player has them and deduct
	for (const color of Object.keys(payment)) {
		const count = payment[color] ?? 0;
		if (count < 0)
			return gameError(socket, "Payment cannot have negative counts");
		if (count > player.stones[color])
			return gameError(socket, `Not enough ${color} stones`);
		player.stones[color] -= count;
	}

	discardFromArea(gs, player, cardId);
	recomputePermanents(player);

	broadcastDelta(io, gs);
	io.to(gs.roomId).emit(GameEvents.ACTION, {
		action: "remove",
		userId,
		username: player.username,
		cardId,
	});
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
	io.to(gs.roomId).emit(GameEvents.ACTION, {
		action: "activate",
		userId,
		username: player.username,
		cardId,
	});
	emitInteractionIfPending(io, gs);
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

	const {
		type: interactionType,
		cardId,
		context: pCtx,
	} = gs.pendingInteraction;
	const { value } = payload ?? {};

	const respondAction = {
		action: "respond",
		userId,
		username: getPlayer(gs, userId)?.username ?? "",
		cardId,
		interactionType,
	};

	// Stone overflow: player sends kept stone counts { red, blue, purple } summing to cap
	if (gs.pendingInteraction.type === "stoneOverflow") {
		const cap = gs.pendingInteraction.context.cap;
		const player = getPlayer(gs, userId);
		if (!player) return gameError(socket, "Player not found");
		if (
			typeof value !== "object" ||
			value === null ||
			typeof value.red !== "number" ||
			typeof value.blue !== "number" ||
			typeof value.purple !== "number"
		) {
			return gameError(socket, "Invalid stone overflow payload");
		}
		const { red, blue, purple } = value;
		if (red < 0 || blue < 0 || purple < 0)
			return gameError(socket, "Stone counts cannot be negative");
		if (
			red > player.stones.red ||
			blue > player.stones.blue ||
			purple > player.stones.purple
		)
			return gameError(socket, "Cannot keep more stones than you have");
		if (red + blue + purple !== cap)
			return gameError(socket, `Kept total must equal cap (${cap})`);
		player.stones.red = red;
		player.stones.blue = blue;
		player.stones.purple = purple;
		gs.pendingInteraction = null;
		broadcastDelta(io, gs);
		io.to(gs.roomId).emit(GameEvents.ACTION, respondAction);
		return;
	}

	// Build context from pending + response
	const responseContext = buildResponseContext(interactionType, value, pCtx);
	gs.pendingInteraction = null;

	// Re-run the effect with the response context
	const effectingPlayer =
		gs.players.find((p) =>
			pCtx?.actingUserId ? p.userId === pCtx.actingUserId : p.userId === userId,
		) ?? getPlayer(gs, userId);

	const def = CardEffectRepo[cardId];
	if (!def) return gameError(socket, "No effect def for responding card");

	// Find the relevant effect index.
	// During action phase, Genie may have activated a card's active effect and parked it
	// in pendingGenieActivations; in that case we must look for "active", not "instant".
	const isGenieSubActivation =
		gs.pendingGenieActivations?.activatingCardId === cardId;
	let eIdx = def.effects.findIndex((e) =>
		isGenieSubActivation
			? e.type === "active"
			: (gs.phase === "resolution" && e.type === "active") ||
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
		if (gs.phase === "resolution") {
			if (gs.pendingInteraction) {
				broadcastDelta(io, gs);
				return gameError(socket, result.error ?? "Response failed");
			}
			const effPlayer = getPlayer(gs, effectingPlayer.userId);
			if (effPlayer && !effPlayer.activeEffectsUsed.includes(cardId)) {
				effPlayer.activeEffectsUsed.push(cardId);
			}
			broadcastDelta(io, gs);
			return;
		}
		return gameError(socket, result.error ?? "Response failed");
	}

	// Mark active as used if resolution phase and fully done
	if (!result.needsInteraction && gs.phase === "resolution") {
		const effPlayer = getPlayer(gs, effectingPlayer.userId);
		if (effPlayer && !effPlayer.activeEffectsUsed.includes(cardId)) {
			effPlayer.activeEffectsUsed.push(cardId);
		}
	}

	if (!result.needsInteraction) {
		checkStoneOverflow(gs, effectingPlayer.userId);
	}

	// Resume Genie activation sequence if a sub-card's interaction just fully resolved
	if (
		!result.needsInteraction &&
		!gs.pendingInteraction &&
		gs.pendingGenieActivations
	) {
		const { remainingCardIds, actingUserId, activatingCardId } =
			gs.pendingGenieActivations;
		gs.pendingGenieActivations = null;
		const geniePlayer = getPlayer(gs, actingUserId);
		if (geniePlayer) {
			if (
				activatingCardId &&
				!geniePlayer.activeEffectsUsed.includes(activatingCardId)
			) {
				geniePlayer.activeEffectsUsed.push(activatingCardId);
			}
			const stillRemaining = remainingCardIds.filter((id) =>
				geniePlayer.area.includes(id),
			);
			if (stillRemaining.length > 0) {
				gs.pendingInteraction = {
					type: "genieActivation",
					forUserId: actingUserId,
					cardId: 49,
					context: {
						phase: "geniePickNext",
						prompt: "Genie — choose which card to activate",
						options: stillRemaining,
					},
				};
			}
		}
	}

	broadcastDelta(io, gs);
	io.to(gs.roomId).emit(GameEvents.ACTION, respondAction);
	emitInteractionIfPending(io, gs);
}

function buildResponseContext(type, value, pCtx) {
	switch (type) {
		case "target":
			return { ...pCtx, targetUserId: value };
		case "genieActivation":
			return { ...pCtx, cardId: value, value };
		case "card":
			if (pCtx?.phase === "pickTargetCard") {
				return { ...pCtx, targetCardId: value, cardId: value, value };
			}
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

	const endTurnAction = {
		action: "end-turn",
		userId,
		username: getPlayer(gs, userId)?.username ?? "",
	};

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
		io.to(gs.roomId).emit(GameEvents.ACTION, endTurnAction);
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
		io.to(gs.roomId).emit(GameEvents.ACTION, endTurnAction);
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
