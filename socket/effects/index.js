/**
 * Vale of Eternity — Card Effect Resolution Engine
 *
 * Entry point: resolveEffect(gs, userId, cardId, effectIndex, context?)
 *
 * The engine is pure logic. It reads from and mutates `gs` (game state) directly.
 * Callers are responsible for broadcasting state after mutations.
 */

import { CardEffectRepo, SUMMON_BLOCK_CHECKS } from "./repo.js";
import { CardData } from "./cardData.js";
import {
	getPlayer,
	earnScore,
	loseScore,
	stealScore,
	earnStones,
	discardStones,
	exchangeStones,
	exchangeAllStonesToPurple,
	drawCards,
	recoverCard,
	discardFromHand,
	discardFromArea,
	fromDiscardToHand,
	putCardOnDeck,
	recomputePermanents,
	stoneValue,
	totalStones,
	stoneCap,
	effectiveCost,
} from "../store/game.js";
import { handleGenie } from "./custom/genie.js";
import { handleGenieExalted } from "./custom/genieExalted.js";
import { handleScorch } from "./custom/scorch.js";
import { handleHydra } from "./custom/hydra.js";

// ─── Main entry point ─────────────────────────────────────────────────────

/**
 * Resolve one effect on a card for a player.
 *
 * @param {object} gs          — game state (mutated in place)
 * @param {string} userId      — acting player
 * @param {number} cardId      — card whose effect fires
 * @param {number} effectIndex — index into CardEffectRepo[cardId].effects
 * @param {object|null} context — summon payment context { payment } or interaction response
 * @returns {{ ok: boolean, error?: string, needsInteraction?: boolean }}
 */
export function resolveEffect(gs, userId, cardId, effectIndex, context) {
	const def = CardEffectRepo[cardId];
	if (!def)
		return { ok: false, error: `No effect definition for card ${cardId}` };

	const effect = def.effects[effectIndex];
	if (!effect)
		return { ok: false, error: `No effect[${effectIndex}] for card ${cardId}` };

	const player = getPlayer(gs, userId);
	if (!player) return { ok: false, error: "Player not found" };

	return executeSteps(gs, player, cardId, effect.steps, context);
}

// ─── Step executor ────────────────────────────────────────────────────────

/**
 * Execute a sequence of steps.
 * Stops early if a step returns { ok: false } or needs interaction.
 */
function executeSteps(gs, player, sourceCardId, steps, context) {
	for (const step of steps) {
		const result = executeStep(gs, player, sourceCardId, step, context);
		if (!result.ok || result.needsInteraction) return result;
	}
	return { ok: true };
}

function executeStep(gs, player, sourceCardId, step, context) {
	switch (step.action) {
		// ── Score ────────────────────────────────────────────────────────────
		case "earnScore": {
			const amount = resolveAmount(gs, player, step.amount);
			earnScore(player, amount);
			return { ok: true };
		}

		case "earnScorePer": {
			const cards = resolveScope(gs, player, step.scope);
			earnScore(player, step.amount * cards.length);
			return { ok: true };
		}

		case "earnScorePerFamily": {
			const cards = resolveScope(gs, player, step.scope);
			const families = new Set(
				cards.map((id) => CardData[id]?.family).filter(Boolean),
			);
			earnScore(player, step.amount * families.size);
			return { ok: true };
		}

		case "earnScorePerPaidStone": {
			// Phoenix: earn score 1 per red stone used in the summon payment
			const payment = context?.payment ?? {};
			const count = payment[step.stoneType] ?? 0;
			earnScore(player, count);
			return { ok: true };
		}

		case "loseScore": {
			loseScore(player, step.amount);
			return { ok: true };
		}

		case "stealScore": {
			// Requires interaction to pick opponent (unless only 1 opponent)
			const opponents = gs.players.filter((p) => p.userId !== player.userId);
			if (opponents.length === 0) return { ok: true }; // no-op
			if (opponents.length === 1) {
				stealScore(opponents[0], player, step.amount);
				return { ok: true };
			}
			// Multiple opponents — need selection
			return requestInteraction(
				gs,
				player.userId,
				sourceCardId,
				"target",
				{
					prompt: "Choose an opponent to steal from",
					options: opponents.map((p) => p.userId),
					amount: step.amount,
					stepAction: "stealScore",
				},
				context,
				() => {
					const target = getPlayer(gs, context?.value ?? context?.targetUserId);
					if (!target) return { ok: false, error: "Invalid target" };
					stealScore(target, player, step.amount);
					return { ok: true };
				},
			);
		}

		// ── Stones ───────────────────────────────────────────────────────────
		case "earnStone": {
			earnStones(player, step.stoneType, step.count);
			return { ok: true };
		}

		case "discardStone": {
			if (step.stoneType === "all") {
				discardStones(player, "all");
				return { ok: true };
			}
			if (!discardStones(player, step.stoneType)) {
				return { ok: false, error: `No ${step.stoneType} stone to discard` };
			}
			return { ok: true };
		}

		case "exchangeStone": {
			// e.g. exchange blue→purple (1 for 1) or purple→blue (1 to 3)
			if (step.to === "blue" && step.count > 1) {
				// Exchange 1 purple → 3 blue (Snail Maiden)
				if (!discardStones(player, step.from)) {
					return { ok: false, error: `No ${step.from} stone` };
				}
				earnStones(player, step.to, step.count);
				return { ok: true };
			}
			if (!exchangeStones(player, step.from, step.to, step.count ?? 1)) {
				return { ok: false, error: `Not enough ${step.from} stones` };
			}
			return { ok: true };
		}

		case "exchangeAllStonesToPurple": {
			exchangeAllStonesToPurple(player);
			return { ok: true };
		}

		// ── Cards ─────────────────────────────────────────────────────────────
		case "draw": {
			drawCards(gs, player, step.count);
			return { ok: true };
		}

		case "recover": {
			// Self-recover: move sourceCardId from area to hand
			if (!recoverCard(player, sourceCardId)) {
				return { ok: false, error: "Card not in area (recover)" };
			}
			recomputePermanents(player);
			return { ok: true };
		}

		case "recoverTarget": {
			// Recover a filtered card from own area — requires interaction if multiple matches
			const filter = step.filter ?? {};
			const matches = player.area.filter((id) => matchesFilter(id, filter));
			if (matches.length === 0) {
				return { ok: false, error: "No matching card in area to recover" };
			}
			if (matches.length === 1) {
				recoverCard(player, matches[0]);
				recomputePermanents(player);
				return { ok: true };
			}
			// Need player to pick which card
			return requestInteraction(
				gs,
				player.userId,
				sourceCardId,
				"card",
				{
					prompt: "Choose a card to recover",
					options: matches,
					filter,
				},
				context,
				() => {
					const chosen = context?.value ?? context?.cardId;
					if (!chosen || !matches.includes(chosen))
						return { ok: false, error: "Invalid card choice" };
					recoverCard(player, chosen);
					recomputePermanents(player);
					return { ok: true };
				},
			);
		}

		case "recoverEarnCost": {
			// Aeris (61): recover another card from area, earn score = its written cost
			const others = player.area.filter((id) => id !== sourceCardId);
			if (others.length === 0) {
				return { ok: false, error: "No other card in area to recover" };
			}
			if (others.length === 1) {
				const card = CardData[others[0]];
				earnScore(player, card?.cost ?? 0);
				recoverCard(player, others[0]);
				recomputePermanents(player);
				return { ok: true };
			}
			return requestInteraction(
				gs,
				player.userId,
				sourceCardId,
				"card",
				{
					prompt: "Choose a card to recover (earn its cost)",
					options: others,
				},
				context,
				() => {
					const chosen = context?.value ?? context?.cardId;
					if (!chosen || !others.includes(chosen))
						return { ok: false, error: "Invalid card" };
					const card = CardData[chosen];
					earnScore(player, card?.cost ?? 0);
					recoverCard(player, chosen);
					recomputePermanents(player);
					return { ok: true };
				},
			);
		}

		case "discardFromHand": {
			// Requires player to choose which hand card to discard
			if (player.hand.length === 0) {
				return { ok: false, error: "Empty hand — cannot discard" };
			}
			return requestInteraction(
				gs,
				player.userId,
				sourceCardId,
				"card",
				{
					prompt: "Choose a card from your hand to discard",
					options: player.hand,
				},
				context,
				() => {
					const chosen = context?.value ?? context?.cardId;
					if (!chosen || !player.hand.includes(chosen))
						return { ok: false, error: "Invalid card" };
					discardFromHand(gs, player, chosen);
					if (step.then?.earnCost) {
						earnScore(player, CardData[chosen]?.cost ?? 0);
					}
					if (step.then?.earnStone) {
						earnStones(player, step.then.earnStone, 1);
					}
					return { ok: true };
				},
			);
		}

		case "discardFromArea": {
			// Cerberus: discard up to N of your OTHER summoned cards
			const others = player.area.filter((id) => id !== sourceCardId);
			if (others.length === 0) return { ok: true }; // nothing to discard
			const maxCount = step.maxCount ?? 1;
			// Need player to select up to maxCount cards
			return requestInteraction(
				gs,
				player.userId,
				sourceCardId,
				"cards",
				{
					prompt: `Choose up to ${maxCount} cards in your area to discard`,
					options: others,
					maxCount,
				},
				context,
				() => {
					const chosen = context?.value ?? context?.cardIds ?? [];
					const valid = chosen.filter((id) => others.includes(id));
					for (const id of valid.slice(0, maxCount)) {
						discardFromArea(gs, player, id);
					}
					recomputePermanents(player);
					return { ok: true };
				},
			);
		}

		case "fromDiscardToHand": {
			// Mimic: take a filtered card from discard pile
			const filter = step.filter ?? {};
			const matches = gs.discardPile.filter((id) => matchesFilter(id, filter));
			if (matches.length === 0) {
				return { ok: false, error: "No matching card in discard pile" };
			}
			if (matches.length === 1) {
				fromDiscardToHand(gs, player, matches[0]);
				return { ok: true };
			}
			return requestInteraction(
				gs,
				player.userId,
				sourceCardId,
				"card",
				{
					prompt: "Choose a card from discard pile",
					options: matches,
					filter,
				},
				context,
				() => {
					const chosen = context?.value ?? context?.cardId;
					if (!chosen || !matches.includes(chosen))
						return { ok: false, error: "Invalid card" };
					fromDiscardToHand(gs, player, chosen);
					return { ok: true };
				},
			);
		}

		case "putSelfOnDeck": {
			// Tengu: move sourceCardId from area to top of draw deck
			if (!putCardOnDeck(gs, player, sourceCardId)) {
				return { ok: false, error: "Card not in area" };
			}
			recomputePermanents(player);
			return { ok: true };
		}

		case "discardSelfSummonFree": {
			// Young Forest Spirit (45) or Dragon Egg (63):
			// discard a card from hand, then summon another card (optionally filtered) for free.
			// Requires two-step interaction: pick card to discard, then pick card to summon.
			const filter = step.filter ?? null;
			const handOptions = player.hand.filter((id) => {
				if (!filter) return true;
				return matchesFilter(id, filter);
			});
			if (handOptions.length === 0) {
				return {
					ok: false,
					error: "No matching card in hand to summon for free",
				};
			}

			// First: discard a card from hand (any card if no filter, or filtered card)
			// For Young Forest Spirit (45): discard any, summon any
			// For Dragon Egg (63): discard self (but self is already in area after instant), summon dragon
			// Per plan: Cerberus/Dragon Egg: "Discard this card and summon a dragon card for free"
			// Dragon Egg is already in area, so we: area→discard self, then summon dragon from hand
			if (sourceCardId === 63) {
				// Dragon Egg: discard self from area, summon a dragon card from hand for free
				const dragons = player.hand.filter(
					(id) => CardData[id]?.family === "dragon",
				);
				if (dragons.length === 0) {
					return { ok: false, error: "No dragon card in hand to summon" };
				}
				return requestInteraction(
					gs,
					player.userId,
					sourceCardId,
					"card",
					{
						prompt: "Choose a dragon card from your hand to summon for free",
						options: dragons,
					},
					context,
					() => {
						const chosen = context?.value ?? context?.cardId;
						if (!chosen || !player.hand.includes(chosen))
							return { ok: false, error: "Invalid card" };
						// Discard Dragon Egg from area
						discardFromArea(gs, player, sourceCardId);
						// Summon the chosen dragon for free (zero payment)
						const idx = player.hand.indexOf(chosen);
						player.hand.splice(idx, 1);
						player.area.push(chosen);
						recomputePermanents(player);
						// Fire the summoned card's instant effect
						const def = CardEffectRepo[chosen];
						if (def) {
							const iIdx = def.effects.findIndex((e) => e.type === "instant");
							if (iIdx !== -1) {
								resolveEffect(gs, player.userId, chosen, iIdx, {
									payment: { red: 0, blue: 0, purple: 0 },
								});
							}
						}
						return { ok: true };
					},
				);
			}

			// Young Forest Spirit (45): pick any card to discard, then summon another for free
			return requestInteraction(
				gs,
				player.userId,
				sourceCardId,
				"discardThenSummon",
				{
					prompt: "Discard a card from your hand, then summon another for free",
					discardOptions: player.hand,
					summonOptions: player.hand,
				},
				context,
				() => {
					const { discardCardId, summonCardId } = context?.value ?? {};
					if (!discardCardId || !player.hand.includes(discardCardId)) {
						return { ok: false, error: "Invalid discard card" };
					}
					if (!summonCardId || summonCardId === discardCardId) {
						return { ok: false, error: "Invalid summon card" };
					}
					if (!player.hand.includes(summonCardId)) {
						return { ok: false, error: "Summon card not in hand" };
					}
					discardFromHand(gs, player, discardCardId);
					// Summon free
					const idx = player.hand.indexOf(summonCardId);
					if (idx === -1) return { ok: false, error: "Card no longer in hand" };
					player.hand.splice(idx, 1);
					player.area.push(summonCardId);
					recomputePermanents(player);
					const def = CardEffectRepo[summonCardId];
					if (def) {
						const iIdx = def.effects.findIndex((e) => e.type === "instant");
						if (iIdx !== -1) {
							resolveEffect(gs, player.userId, summonCardId, iIdx, {
								payment: { red: 0, blue: 0, purple: 0 },
							});
						}
					}
					return { ok: true };
				},
			);
		}

		// ── Opponent effects ──────────────────────────────────────────────────
		case "opponentDiscardCard": {
			// Two-step interaction:
			// 1. Acting player picks opponent
			// 2. Chosen opponent picks which of their filtered cards to discard
			const family = step.filter?.family;
			const opponentsWithCard = gs.players.filter((p) => {
				if (p.userId === player.userId) return false;
				return p.area.some((id) => !family || CardData[id]?.family === family);
			});
			if (opponentsWithCard.length === 0) {
				// No valid targets — but if this was a summon-block-checked card, it shouldn't get here
				return { ok: true }; // skip gracefully
			}

			// Phase A: pick opponent
			if (!context?.targetUserId) {
				return requestInteraction(
					gs,
					player.userId,
					sourceCardId,
					"target",
					{
						prompt: family
							? `Choose an opponent who has a summoned ${family} card`
							: "Choose an opponent",
						options: opponentsWithCard.map((p) => p.userId),
						family,
						phase: "pickOpponent",
					},
					context,
					() => {
						return { ok: true, needsInteraction: true }; // handled outside
					},
				);
			}

			// Phase A is done — context has targetUserId; now phase B: target picks card
			if (!context?.targetCardId) {
				const target = getPlayer(gs, context.targetUserId);
				if (!target) return { ok: false, error: "Target player not found" };
				const eligible = target.area.filter(
					(id) => !family || CardData[id]?.family === family,
				);
				if (eligible.length === 0) {
					return { ok: true }; // nothing to discard now (they might have had no card at resolution)
				}
				if (eligible.length === 1) {
					discardFromArea(gs, target, eligible[0]);
					recomputePermanents(target);
					return { ok: true };
				}
				// Ask target to pick
				gs.pendingInteraction = {
					type: "card",
					forUserId: context.targetUserId,
					cardId: sourceCardId,
					context: {
						prompt: `Discard one of your summoned ${family ?? "any"} cards`,
						options: eligible,
						phase: "pickTargetCard",
						actingUserId: player.userId,
						targetUserId: context.targetUserId,
					},
				};
				return { ok: true, needsInteraction: true };
			}

			// Phase B done — target sent their card choice
			const target = getPlayer(gs, context.targetUserId);
			if (!target) return { ok: false, error: "Target not found" };
			const eligible = target.area.filter(
				(id) => !family || CardData[id]?.family === family,
			);
			if (!eligible.includes(context.targetCardId)) {
				return { ok: false, error: "Invalid card choice from target" };
			}
			discardFromArea(gs, target, context.targetCardId);
			recomputePermanents(target);
			return { ok: true };
		}

		// ── Conditional ───────────────────────────────────────────────────────
		case "conditional": {
			const met = checkCondition(gs, player, step.condition);
			const branch = met ? (step.then ?? []) : (step.else ?? []);
			return executeSteps(gs, player, sourceCardId, branch, context);
		}

		case "choice": {
			if (context?.choiceIndex === undefined) {
				gs.pendingInteraction = {
					type: "choice",
					forUserId: player.userId,
					cardId: sourceCardId,
					context: {
						prompt: "Choose an option",
						options: step.options.map((o) => o.label),
					},
				};
				return { ok: true, needsInteraction: true };
			}
			const raw = context.choiceIndex;
			// Accept both numeric index and string label
			const idx = typeof raw === "number"
				? raw
				: step.options.findIndex((o) => o.label === raw);
			if (idx < 0 || idx >= step.options.length) {
				return { ok: false, error: "Invalid option" };
			}
			gs.pendingInteraction = null;
			return executeSteps(
				gs,
				player,
				sourceCardId,
				step.options[idx].steps,
				context,
			);
		}

		// ── Custom handlers ───────────────────────────────────────────────────
		case "custom": {
			switch (step.handler) {
				case "genie":
					return handleGenie(gs, player, resolveEffect);
				case "genieExalted":
					return handleGenieExalted(gs, player, context, resolveEffect);
				case "scorch":
					return handleScorch(gs, player, context, resolveEffect);
				case "hydra":
					return handleHydra(gs, player, context);
				default:
					return {
						ok: false,
						error: `Unknown custom handler: ${step.handler}`,
					};
			}
		}

		// ── Permanent steps (no-op during runtime — handled by recomputePermanents) ──
		case "stoneCapacityBonus":
		case "costReduction":
		case "stoneValueBonus":
		case "stoneOverride":
		case "trigger":
			return { ok: true }; // silently handled during permanent recomputation

		default:
			return { ok: false, error: `Unknown step action: ${step.action}` };
	}
}

// ─── Interaction helper ───────────────────────────────────────────────────

/**
 * If context already has the required response, call resolver immediately.
 * Otherwise store pendingInteraction and return needsInteraction.
 */
function requestInteraction(
	gs,
	userId,
	cardId,
	type,
	ctxData,
	context,
	resolver,
) {
	if (context && isInteractionResolved(type, context)) {
		return resolver();
	}
	gs.pendingInteraction = {
		type,
		forUserId: userId,
		cardId,
		context: ctxData,
	};
	return { ok: true, needsInteraction: true };
}

function isInteractionResolved(type, context) {
	if (!context) return false;
	switch (type) {
		case "target":
			return !!(context.targetUserId || context.value);
		case "card":
			return !!(context.cardId || context.value);
		case "cards":
			return !!(context.cardIds || context.value);
		case "choice":
			return context.choiceIndex !== undefined;
		case "discardThenSummon":
			return !!(context.value?.discardCardId && context.value?.summonCardId);
		default:
			return false;
	}
}

// ─── Scope resolution ────────────────────────────────────────────────────

/**
 * Resolve a scope descriptor to a list of card IDs.
 */
function resolveScope(gs, player, scope) {
	if (!scope) return [];
	const { location, owner, filter } = scope;
	let cards;
	if (owner === "self" || !owner) {
		cards =
			location === "hand"
				? [...player.hand]
				: location === "area"
					? [...player.area]
					: location === "discard"
						? [...player.discard]
						: [...player.area];
	}
	return filter ? cards.filter((id) => matchesFilter(id, filter)) : cards;
}

/**
 * Check if a card ID matches a filter descriptor.
 */
function matchesFilter(cardId, filter) {
	const card = CardData[cardId];
	if (!card) return false;
	if (filter.family && card.family !== filter.family) return false;
	if (filter.costMax !== undefined && card.cost > filter.costMax) return false;
	if (filter.costValues && !filter.costValues.includes(card.cost)) return false;
	if (filter.effectType) {
		// Check if the card in the CardEffectRepo has an effect of this type
		const def = CardEffectRepo[cardId];
		if (!def || !def.effects.some((e) => e.type === filter.effectType))
			return false;
	}
	return true;
}

// ─── Condition evaluation ────────────────────────────────────────────────

function checkCondition(gs, player, condition) {
	if (!condition) return true;
	switch (condition.check) {
		case "noFamilyInArea":
			return !player.area.some(
				(id) => CardData[id]?.family === condition.family,
			);
		case "hasStone":
			return (player.stones[condition.stoneType] ?? 0) > 0;
		case "handLessThan":
			return player.hand.length < condition.count;
		case "handEqualsAreaCount":
			return player.hand.length === player.area.length;
		case "opponentHasMoreScore":
			return gs.players.some(
				(p) => p.userId !== player.userId && p.score > player.score,
			);
		case "allCostsPresentInArea": {
			const costs = new Set(player.area.map((id) => CardData[id]?.cost));
			return condition.costs.every((c) => costs.has(c));
		}
		case "paymentUsedStone": {
			// Checked against payment context passed during onSummon trigger
			// This is evaluated at the time of summon; context carries the payment
			return false; // evaluated by fireOnSummonTriggers, not inline
		}
		case "tamedCardFamily":
			return false; // evaluated by fireOnTameTriggers, not inline
		default:
			return false;
	}
}

// ─── Computed value resolution ───────────────────────────────────────────

function resolveAmount(gs, player, amount) {
	if (typeof amount === "number") return amount;
	if (!amount?.compute) return 0;
	switch (amount.compute) {
		case "stoneTotal": {
			if (amount.stoneType) {
				// Total VALUE of stones of that type (count × face value + bonus)
				return stoneValue(player, amount.stoneType);
			}
			// Total value of all stones
			return stoneValue(player, null);
		}
		case "stoneCount":
			// Just count (not value)
			return player.stones[amount.stoneType] ?? 0;
		case "count":
			return resolveScope(gs, player, amount.scope).length;
		case "refCardCost":
			return CardData[amount.cardId]?.cost ?? 0;
		default:
			return 0;
	}
}

// ─── Permanent trigger firers ────────────────────────────────────────────

/**
 * Fire all onSummon triggers for the acting player when a card is summoned.
 * The newly summoned card is already in player.area at this point.
 *
 * @param {object} gs
 * @param {object} player       — player who summoned
 * @param {number} summonedCardId
 * @param {object} payment      — { red, blue, purple } — actual payment used
 */
export function fireOnSummonTriggers(gs, player, summonedCardId, payment) {
	for (const trigger of player.onSummonTriggers) {
		// Don't fire a trigger from the same card that was just summoned (Kappa self-exception)
		if (trigger.cardId === summonedCardId) continue;

		// Check condition
		const cond = trigger.condition;
		if (cond) {
			if (cond.check === "paymentUsedStone") {
				const count = payment[cond.stoneType] ?? 0;
				if (count === 0) continue;
			}
			// Other conditions checked inline
		}

		// Execute trigger steps
		executeSteps(gs, player, trigger.cardId, trigger.steps, { payment });
	}
}

/**
 * Fire all onTame triggers for the acting player when a card is tamed.
 */
export function fireOnTameTriggers(gs, player, tamedCardId) {
	const tamedCard = CardData[tamedCardId];
	for (const trigger of player.onTameTriggers) {
		const cond = trigger.condition;
		if (cond?.check === "tamedCardFamily" && tamedCard?.family !== cond.family)
			continue;
		executeSteps(gs, player, trigger.cardId, trigger.steps, {});
	}
}

// ─── Pre-summon feasibility check ────────────────────────────────────────

/**
 * Check if a summon action is feasible (instant effect can resolve).
 * Used to block Ember etc. when no valid target exists.
 *
 * @param {object} gs
 * @param {object} player
 * @param {number} cardId
 * @returns {{ ok: boolean, error?: string }}
 */
export function checkSummonFeasibility(gs, player, cardId) {
	const blockCheck = SUMMON_BLOCK_CHECKS[cardId];
	if (!blockCheck) return { ok: true };

	const family = blockCheck.filter?.family;
	const hasTarget = gs.players.some((p) => {
		if (p.userId === player.userId) return false;
		return p.area.some((id) => !family || CardData[id]?.family === family);
	});
	if (!hasTarget) {
		return {
			ok: false,
			error: `Cannot summon: no opponent has a summoned ${family} card`,
		};
	}
	return { ok: true };
}

/**
 * Get which cards in an area have an unresolved active effect for this round.
 */
export function getActivatableCards(player) {
	return player.area.filter((cardId) => {
		const def = CardEffectRepo[cardId];
		if (!def) return false;
		if (player.activeEffectsUsed.includes(cardId)) return false;
		return def.effects.some((e) => e.type === "active");
	});
}

/**
 * Determine if a resolvable active effect exists for any unactivated card.
 */
export function hasResolvableActiveEffect(gs, player) {
	return getActivatableCards(player).some((cardId) => {
		const def = CardEffectRepo[cardId];
		const eIdx = def.effects.findIndex((e) => e.type === "active");
		if (eIdx === -1) return false;
		// Quick feasibility: check that mandatory preconditions hold
		const effect = def.effects[eIdx];
		for (const step of effect.steps) {
			if (step.action === "discardStone") {
				if (
					step.stoneType !== "all" &&
					(player.stones[step.stoneType] ?? 0) < 1
				)
					return false;
			}
			if (step.action === "discardFromHand" && player.hand.length === 0)
				return false;
			if (step.action === "fromDiscardToHand") {
				const filter = step.filter ?? {};
				const matches = gs.discardPile.filter((id) =>
					matchesFilter(id, filter),
				);
				if (matches.length === 0) return false;
			}
		}
		return true;
	});
}
