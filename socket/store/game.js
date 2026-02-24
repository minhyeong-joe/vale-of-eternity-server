/**
 * Authoritative server-side game state per room.
 * Every mutation goes through the helper functions here.
 * The engine in effects/index.js calls these helpers.
 */

import { CardData } from "../effects/cardData.js";

/** @type {Map<string, object>} roomId → GameState */
const games = new Map();

// ─── Family → sell reward ──────────────────────────────────────────────────

export const SELL_REWARDS = {
	fire: { red: 3, blue: 0, purple: 0 },
	earth: { red: 4, blue: 0, purple: 0 },
	water: { red: 0, blue: 1, purple: 0 },
	wind: { red: 1, blue: 1, purple: 0 },
	dragon: { red: 0, blue: 0, purple: 1 },
};

// Full deck: card IDs 1–70
const FULL_DECK = Array.from({ length: 70 }, (_, i) => i + 1);

const PLAYER_COLORS = ["purple", "green", "black", "gray"];

// ─── Snake draft order helpers ─────────────────────────────────────────────

/**
 * Produce the snake-draft pick sequence for N players (2 picks each).
 * Forward pass: [0,1,2,3], reverse pass: [3,2,1,0]
 * Last player picks twice in a row (end of forward + start of reverse).
 * @param {number} n
 * @param {number} firstPlayerIndex
 * @returns {number[]} player indices in pick order
 */
function buildSnakeDraftOrder(n, firstPlayerIndex) {
	const forward = Array.from(
		{ length: n },
		(_, i) => (firstPlayerIndex + i) % n,
	);
	const backward = [...forward].reverse();
	return [...forward, ...backward];
}

// ─── Shuffle ──────────────────────────────────────────────────────────────

function shuffle(arr) {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

// ─── Game creation ─────────────────────────────────────────────────────────

/**
 * Create a fresh game state for a room.
 * @param {string} roomId
 * @param {Array<{ userId: string, socketId: string, username: string }>} players
 * @returns {object} GameState
 */
export function createGame(roomId, players) {
	const deck = shuffle(FULL_DECK);

	const gamePlayers = players.map((p, i) => ({
		userId: p.userId,
		socketId: p.socketId,
		username: p.username,
		color: PLAYER_COLORS[i] ?? "gray",
		hand: [],
		area: [],
		discard: [],
		score: i, // first player starts at 0, etc. (actually all start at 0; scoring track offset)
		stones: { red: 0, blue: 0, purple: 0 },
		activeEffectsUsed: [],
		// eagerly-maintained permanent modifier caches — recomputed when area changes
		stoneCapacityBonus: 0,
		costReductionAll: 0,
		costReductionByFamily: { fire: 0, water: 0, earth: 0, wind: 0, dragon: 0 },
		stoneValueBonus: { red: 0, blue: 0, purple: 0 },
		stoneOverrides: [], // [{ from, countsAs }]
		onSummonTriggers: [], // [{ cardId, condition?, steps }]
		onTameTriggers: [], // [{ cardId, condition?, steps }]
	}));

	// first player starts at 1 pt, second at 2 pts, etc.
	gamePlayers.forEach((p, i) => {
		p.score = i + 1;
	});
	gamePlayers[0].score = 1;
	if (gamePlayers[1]) gamePlayers[1].score = 2;
	if (gamePlayers[2]) gamePlayers[2].score = 3;
	if (gamePlayers[3]) gamePlayers[3].score = 4;

	const gs = {
		roomId,
		round: 0, // will be incremented to 1 on startRound
		phase: "hunting",
		firstPlayerIndex: 0,
		activePlayerIndex: 0,

		huntPickOrder: [], // set at round start
		huntPicksDone: 0,

		drawDeck: deck,
		discardPile: [],
		boardZones: { fire: [], water: [], earth: [], wind: [], dragon: [] },
		boardMarkers: {}, // cardId(string) → userId

		pendingInteraction: null,

		players: gamePlayers,
	};

	games.set(roomId, gs);
	startRound(gs);
	return gs;
}

/** @param {string} roomId */
export function getGame(roomId) {
	return games.get(roomId) ?? null;
}

/** @param {string} roomId */
export function deleteGame(roomId) {
	games.delete(roomId);
}

// ─── Round / phase management ─────────────────────────────────────────────

/**
 * Advance to the next round: deal board cards, set up snake draft.
 * Mutates gs in place.
 */
export function startRound(gs) {
	gs.round += 1;
	gs.phase = "hunting";
	gs.boardZones = { fire: [], water: [], earth: [], wind: [], dragon: [] };
	gs.boardMarkers = {};
	gs.huntPicksDone = 0;

	// Rotate first player
	const n = gs.players.length;
	if (gs.round > 1) {
		gs.firstPlayerIndex = (gs.firstPlayerIndex + 1) % n;
	}

	const cardsNeeded = 2 * n;
	const families = ["fire", "water", "earth", "wind", "dragon"];

	for (let i = 0; i < cardsNeeded; i++) {
		ensureDeck(gs);
		const cardId = gs.drawDeck.shift();
		// Sort by family
		const card = CardData[cardId];
		if (card) {
			gs.boardZones[card.family].push(cardId);
		} else {
			gs.boardZones.fire.push(cardId); // fallback
		}
	}

	gs.huntPickOrder = buildSnakeDraftOrder(n, gs.firstPlayerIndex);
	gs.activePlayerIndex = gs.huntPickOrder[0];
}

/**
 * Start the action phase: first player goes first.
 */
export function startActionPhase(gs) {
	gs.phase = "action";
	gs.activePlayerIndex = gs.firstPlayerIndex;
}

/**
 * Advance to next player in action phase.
 * Returns true if we've gone all the way around (should start resolution).
 */
export function advanceActionTurn(gs) {
	const n = gs.players.length;
	const nextIndex = (gs.activePlayerIndex + 1) % n;
	if (nextIndex === gs.firstPlayerIndex) {
		// All players have gone — but action phase allows unlimited actions.
		// Actually: action phase each player takes unlimited actions and then ends their turn.
		// So we just advance to next player; when they end-turn, we advance again.
		gs.activePlayerIndex = nextIndex;
		return true; // signal: round of turns complete → start resolution
	}
	gs.activePlayerIndex = nextIndex;
	return false;
}

/**
 * Start the resolution phase: first player activates first.
 */
export function startResolutionPhase(gs) {
	gs.phase = "resolution";
	gs.activePlayerIndex = gs.firstPlayerIndex;
	// Reset used effects for all players
	gs.players.forEach((p) => {
		p.activeEffectsUsed = [];
	});
}

/**
 * Advance to next player in resolution phase.
 * Returns true if all players have gone (end of round).
 */
export function advanceResolutionTurn(gs) {
	const n = gs.players.length;
	const nextIndex = (gs.activePlayerIndex + 1) % n;
	if (nextIndex === gs.firstPlayerIndex) {
		gs.activePlayerIndex = nextIndex;
		return true; // all players done → end of round
	}
	gs.activePlayerIndex = nextIndex;
	return false;
}

// ─── Deck helpers ─────────────────────────────────────────────────────────

/** If deck is empty, shuffle discard to form new deck. */
export function ensureDeck(gs) {
	if (gs.drawDeck.length === 0) {
		gs.drawDeck = shuffle(gs.discardPile);
		gs.discardPile = [];
	}
}

// ─── Player / stone helpers ───────────────────────────────────────────────

/** Get player object by userId */
export function getPlayer(gs, userId) {
	return gs.players.find((p) => p.userId === userId) ?? null;
}

/** Get player index by userId */
export function getPlayerIndex(gs, userId) {
	return gs.players.findIndex((p) => p.userId === userId);
}

/** Effective stone cap for a player (base 4 + bonuses from permanents like Hestia) */
export function stoneCap(player) {
	return 4 + player.stoneCapacityBonus;
}

/** Total stone count */
export function totalStones(player) {
	return player.stones.red + player.stones.blue + player.stones.purple;
}

/** Total stone value factoring in stoneValueBonus and stoneOverrides */
export function stoneValue(player, stoneType, count = null) {
	const types = stoneType ? [stoneType] : ["red", "blue", "purple"];
	let total = 0;
	for (const t of types) {
		const baseValue = { red: 1, blue: 3, purple: 6 }[t] ?? 1;
		const bonus = player.stoneValueBonus[t] ?? 0;
		const effectiveValue = baseValue + bonus;
		const cnt = count ?? player.stones[t];
		total += cnt * effectiveValue;
	}
	return total;
}

/**
 * Earn stones for a player. Does NOT enforce the cap — callers must call
 * checkStoneOverflow(gs, userId) after any stone-earning sequence so the
 * player can choose which stones to discard.
 */
export function earnStones(player, stoneType, count) {
	player.stones[stoneType] = (player.stones[stoneType] ?? 0) + count;
}

/**
 * If the player is over their stone cap, set a stoneOverflow pendingInteraction
 * so they can choose which stone(s) to discard.  Only sets the interaction when
 * nothing else is already pending.
 * @param {object} gs
 * @param {string} userId
 */
export function checkStoneOverflow(gs, userId) {
	if (gs.pendingInteraction) return;
	const player = gs.players.find((p) => p.userId === userId);
	if (!player) return;
	const excess = totalStones(player) - stoneCap(player);
	if (excess <= 0) return;
	gs.pendingInteraction = {
		type: "stoneOverflow",
		forUserId: userId,
		cardId: 0,
		context: { excess, cap: stoneCap(player) },
	};
}

/**
 * Discard stones from a player.
 * @param {object} player
 * @param {'red'|'blue'|'purple'|'all'} stoneType
 * @param {number} [count=1] — used when stoneType !== 'all'
 * @returns {boolean} success
 */
export function discardStones(player, stoneType, count = 1) {
	if (stoneType === "all") {
		player.stones = { red: 0, blue: 0, purple: 0 };
		return true;
	}
	if ((player.stones[stoneType] ?? 0) < count) return false;
	player.stones[stoneType] -= count;
	return true;
}

/**
 * Exchange stones: remove `count` of `from` type, add `count` of `to` type.
 * @param {object} player
 * @param {'red'|'blue'|'purple'} from
 * @param {'red'|'blue'|'purple'} to
 * @param {number} [count=1]
 * @returns {boolean} success
 */
export function exchangeStones(player, from, to, count = 1) {
	if ((player.stones[from] ?? 0) < count) return false;
	player.stones[from] -= count;
	earnStones(player, to, count);
	return true;
}

/** Exchange ALL stones → purple (Stone Golem) */
export function exchangeAllStonesToPurple(player) {
	const total = totalStones(player);
	player.stones = { red: 0, blue: 0, purple: 0 };
	earnStones(player, "purple", total);
}

// ─── Score helpers ─────────────────────────────────────────────────────────

export function earnScore(player, amount) {
	player.score = Math.max(0, player.score + amount);
}

export function loseScore(player, amount) {
	player.score = Math.max(0, player.score - amount);
}

export function stealScore(fromPlayer, toPlayer, amount) {
	const actual = Math.min(fromPlayer.score, amount);
	fromPlayer.score = Math.max(0, fromPlayer.score - actual);
	toPlayer.score += actual;
}

// ─── Card draw ─────────────────────────────────────────────────────────────

/**
 * Draw `count` cards from deck into player's hand.
 */
export function drawCards(gs, player, count) {
	for (let i = 0; i < count; i++) {
		ensureDeck(gs);
		if (gs.drawDeck.length === 0) break;
		const cardId = gs.drawDeck.shift();
		player.hand.push(cardId);
	}
}

// ─── Card movement ─────────────────────────────────────────────────────────

/** Move card from player's area to their hand (recover). */
export function recoverCard(player, cardId) {
	const idx = player.area.indexOf(cardId);
	if (idx === -1) return false;
	player.area.splice(idx, 1);
	player.hand.push(cardId);
	return true;
}

/** Move card from player's hand to discard pile. */
export function discardFromHand(gs, player, cardId) {
	const idx = player.hand.indexOf(cardId);
	if (idx === -1) return false;
	player.hand.splice(idx, 1);
	player.discard.push(cardId);
	gs.discardPile.push(cardId);
	return true;
}

/** Move card from player's area to discard pile. */
export function discardFromArea(gs, player, cardId) {
	const idx = player.area.indexOf(cardId);
	if (idx === -1) return false;
	player.area.splice(idx, 1);
	player.discard.push(cardId);
	gs.discardPile.push(cardId);
	return true;
}

/** Move card from discard pile to player's hand (Mimic). */
export function fromDiscardToHand(gs, player, cardId) {
	const idx = gs.discardPile.indexOf(cardId);
	if (idx === -1) return false;
	gs.discardPile.splice(idx, 1);
	player.hand.push(cardId);
	return true;
}

/** Put card from player's area on top of draw deck (Tengu). */
export function putCardOnDeck(gs, player, cardId) {
	const idx = player.area.indexOf(cardId);
	if (idx === -1) return false;
	player.area.splice(idx, 1);
	gs.drawDeck.unshift(cardId);
	return true;
}

/**
 * Summon a card from hand to area.
 * Does NOT fire effects — caller is responsible for that.
 * @param {object} gs
 * @param {object} player
 * @param {number} cardId
 * @param {{ red: number, blue: number, purple: number }} payment
 * @returns {boolean}
 */
export function summonCard(gs, player, cardId, payment) {
	const idx = player.hand.indexOf(cardId);
	if (idx === -1) return false;
	// Deduct payment
	player.stones.red -= payment.red ?? 0;
	player.stones.blue -= payment.blue ?? 0;
	player.stones.purple -= payment.purple ?? 0;
	player.hand.splice(idx, 1);
	player.area.push(cardId);
	return true;
}

// ─── Permanent modifier recomputation ────────────────────────────────────

/**
 * Recompute all permanent modifier caches from the cards currently in a player's area.
 * Call after any area change (summon, remove, recover, discardFromArea).
 */
export function recomputePermanents(player) {
	player.stoneCapacityBonus = 0;
	player.costReductionAll = 0;
	player.costReductionByFamily = {
		fire: 0,
		water: 0,
		earth: 0,
		wind: 0,
		dragon: 0,
	};
	player.stoneValueBonus = { red: 0, blue: 0, purple: 0 };
	player.stoneOverrides = [];
	player.onSummonTriggers = [];
	player.onTameTriggers = [];

	for (const cardId of player.area) {
		applyPermanentEffects(player, cardId);
	}
}

/**
 * Apply permanent effects of a single card to the player's modifier caches.
 * Imported lazily to avoid circular deps with effects/repo.js.
 */
function applyPermanentEffects(player, cardId) {
	// Inline permanent definitions to avoid circular import with effects engine
	const PERMANENTS = getPermanentDefs();
	const defs = PERMANENTS[cardId];
	if (!defs) return;
	for (const step of defs) {
		switch (step.action) {
			case "stoneCapacityBonus":
				player.stoneCapacityBonus += step.amount;
				break;
			case "costReduction":
				if (step.family) {
					player.costReductionByFamily[step.family] =
						(player.costReductionByFamily[step.family] ?? 0) + step.amount;
				} else {
					player.costReductionAll += step.amount;
				}
				break;
			case "stoneValueBonus":
				player.stoneValueBonus[step.stoneType] =
					(player.stoneValueBonus[step.stoneType] ?? 0) + step.bonus;
				break;
			case "stoneOverride":
				player.stoneOverrides.push({
					from: step.from,
					countsAs: step.countsAs,
				});
				break;
			case "trigger":
				if (step.when === "onSummon") {
					player.onSummonTriggers.push({
						cardId,
						condition: step.condition ?? null,
						steps: step.steps,
					});
				} else if (step.when === "onTame") {
					player.onTameTriggers.push({
						cardId,
						condition: step.condition ?? null,
						steps: step.steps,
					});
				}
				break;
		}
	}
}

/** Permanent step definitions (inlined to avoid circular imports) */
let _permanentDefs = null;
function getPermanentDefs() {
	if (_permanentDefs) return _permanentDefs;
	_permanentDefs = {
		1: [{ action: "stoneValueBonus", stoneType: "red", bonus: 1 }], // Agni
		6: [{ action: "stoneCapacityBonus", amount: 2 }], // Hestia
		12: [
			{
				action: "trigger",
				when: "onSummon",
				condition: null,
				steps: [{ action: "earnScorePerPaidStone", stoneType: "red" }],
			},
		], // Phoenix
		17: [
			// Hae-tae
			{ action: "stoneOverride", from: "blue", countsAs: "purple" },
			{ action: "stoneOverride", from: "purple", countsAs: "blue" },
		],
		19: [
			{
				action: "trigger",
				when: "onSummon",
				condition: { check: "paymentUsedStone", stoneType: "blue" },
				steps: [{ action: "earnScore", amount: 2 }],
			},
		], // Kappa
		25: [
			{
				action: "trigger",
				when: "onTame",
				condition: { check: "tamedCardFamily", family: "water" },
				steps: [{ action: "earnStone", stoneType: "blue", count: 2 }],
			},
		], // Triton
		28: [
			// Water Giant
			{ action: "stoneValueBonus", stoneType: "blue", bonus: 1 },
			{ action: "stoneValueBonus", stoneType: "purple", bonus: 1 },
		],
		35: [
			{
				action: "trigger",
				when: "onSummon",
				condition: { check: "paymentUsedStone", stoneType: "purple" },
				steps: [{ action: "earnScore", amount: 3 }],
			},
		], // Gargoyle
		54: [{ action: "costReduction", family: "wind", amount: 2 }], // Hippogriff
		56: [{ action: "costReduction", amount: 1 }], // Pegasus
		58: [
			{
				action: "trigger",
				when: "onSummon",
				condition: null,
				steps: [{ action: "earnScore", amount: 1 }],
			},
		], // Sylph
	};
	return _permanentDefs;
}

// ─── Cost calculation ──────────────────────────────────────────────────────

/**
 * Effective summon cost for a card, factoring in player's permanent reductions.
 */
export function effectiveCost(player, cardId) {
	const card = CardData[cardId];
	if (!card) return 0;
	const familyReduction = player.costReductionByFamily[card.family] ?? 0;
	const allReduction = player.costReductionAll;
	return Math.max(0, card.cost - familyReduction - allReduction);
}

/**
 * Validate payment: total payment value ≥ effective cost, player has those stones.
 * Stone values (respecting stoneValueBonus): red=1, blue=3, purple=6 + any bonus.
 */
export function validatePayment(player, cardId, payment) {
	const cost = effectiveCost(player, cardId);
	const paid =
		stoneValue(player, "red", payment.red ?? 0) +
		stoneValue(player, "blue", payment.blue ?? 0) +
		stoneValue(player, "purple", payment.purple ?? 0);
	if (paid < cost)
		return {
			ok: false,
			error: `Insufficient payment: need ${cost}, paid ${paid}`,
		};
	if ((player.stones.red ?? 0) < (payment.red ?? 0))
		return { ok: false, error: "Not enough red stones" };
	if ((player.stones.blue ?? 0) < (payment.blue ?? 0))
		return { ok: false, error: "Not enough blue stones" };
	if ((player.stones.purple ?? 0) < (payment.purple ?? 0))
		return { ok: false, error: "Not enough purple stones" };
	return { ok: true };
}

// ─── Area limit ────────────────────────────────────────────────────────────

export function areaLimit(gs) {
	return gs.round;
}

// ─── Board marker helpers ─────────────────────────────────────────────────

/**
 * Check if a player has any unclaimed board markers remaining.
 */
export function playerHasBoardMarkers(gs, userId) {
	return Object.values(gs.boardMarkers).some((uid) => uid === userId);
}

/**
 * Get all card IDs on board that are unclaimed.
 */
export function unclaimedBoardCards(gs) {
	const allCards = Object.values(gs.boardZones).flat();
	return allCards.filter((id) => !gs.boardMarkers[id]);
}

// ─── Win condition ─────────────────────────────────────────────────────────

export function checkEndGame(gs) {
	if (gs.round >= 10) return true;
	return gs.players.some((p) => p.score >= 60);
}

// ─── Client-safe state serialization ──────────────────────────────────────

/**
 * Build a personalized state object for the given userId.
 * Opponent hands are hidden (handCount only).
 */
export function toClientState(gs, forUserId) {
	const { CardData: _cd, ...rest } = gs; // strip any accidental CardData ref
	return {
		roomId: gs.roomId,
		round: gs.round,
		phase: gs.phase,
		firstPlayerIndex: gs.firstPlayerIndex,
		activePlayerIndex: gs.activePlayerIndex,
		huntPickOrder: gs.huntPickOrder,
		huntPicksDone: gs.huntPicksDone,
		drawDeckCount: gs.drawDeck.length,
		discardPileCount: gs.discardPile.length,
		boardZones: gs.boardZones,
		boardMarkers: gs.boardMarkers,
		pendingInteraction: gs.pendingInteraction
			? {
					type: gs.pendingInteraction.type,
					forUserId: gs.pendingInteraction.forUserId,
					cardId: gs.pendingInteraction.cardId,
					context: gs.pendingInteraction.context,
				}
			: null,
		players: gs.players.map((p) => {
			const isSelf = p.userId === forUserId;
			return {
				userId: p.userId,
				username: p.username,
				color: p.color,
				score: p.score,
				stones: { ...p.stones },
				area: [...p.area],
				discard: [...p.discard],
				hand: isSelf ? [...p.hand] : [],
				handCount: isSelf ? p.hand.length : p.hand.length,
				activeEffectsUsed: [...(p.activeEffectsUsed || [])],
				stoneValueBonus: p.stoneValueBonus
					? { ...p.stoneValueBonus }
					: { red: 0, blue: 0, purple: 0 },
				stoneValueOverrides:
					p.stoneOverrides && p.stoneOverrides.length > 0
						? p.stoneOverrides[p.stoneOverrides.length - 1] // If multiple, use last
						: null,
				// ...other fields as needed...
			};
		}),
	};
}
