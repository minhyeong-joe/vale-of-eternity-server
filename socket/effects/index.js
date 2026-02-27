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
import { handleScorch, isInstantFeasible } from "./custom/scorch.js";
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

	return executeSteps(gs, player, cardId, effect.steps, context, effect.type);
}

// ─── Step executor ────────────────────────────────────────────────────────

/**
 * Execute a sequence of steps.
 * Stops early if a step returns { ok: false } or needs interaction.
 */
function executeSteps(gs, player, sourceCardId, steps, context, effectType) {
	const resumeFrom = context?.resumeFromStep ?? 0;
	for (let i = 0; i < steps.length; i++) {
		if (i < resumeFrom) continue; // skip steps already committed before this interaction
		const result = executeStep(
			gs,
			player,
			sourceCardId,
			steps[i],
			context,
			effectType,
		);
		if (!result.ok || result.skipped) return result;
		if (result.needsInteraction) {
			// Record which step index paused so resume skips already-committed steps
			if (gs.pendingInteraction?.context) {
				gs.pendingInteraction.context.resumeFromStep = i;
			}
			return result;
		}
	}
	return { ok: true };
}

function executeStep(gs, player, sourceCardId, step, context, effectType) {
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
			const opponents = gs.players.filter((p) => p.userId !== player.userId);
			if (opponents.length === 0) return { ok: true }; // no-op
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
				if (effectType !== "instant")
					return {
						ok: true,
						skipped: true,
						message: `No ${step.stoneType} stone to discard`,
					};
				return { ok: false, error: `No ${step.stoneType} stone to discard` };
			}
			return { ok: true };
		}

		case "exchangeStone": {
			console.log("Exchange step:", step);
			// e.g. exchange blue→purple (1 for 1) or purple→blue (1 to 3)
			if (step.to === "blue" && step.count > 1) {
				// Exchange 1 purple → 3 blue (Snail Maiden)
				if (!discardStones(player, step.from)) {
					console.log(effectType);
					if (effectType !== "instant")
						return {
							ok: true,
							skipped: true,
							message: `No ${step.from} stone to exchange`,
						};
					return {
						ok: false,
						error: `No ${step.from} stone to exchange`,
					};
				}
				earnStones(player, step.to, step.count);
				return { ok: true };
			}
			// if (step.to === "purple" && step.count >= 1) {

			// }
			if (!exchangeStones(player, step.from, step.to, step.count ?? 1)) {
				if (effectType !== "instant")
					return {
						ok: true,
						skipped: true,
						message: `Not enough ${step.from} stones to exchange`,
					};
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
				if (effectType !== "instant")
					return {
						ok: true,
						skipped: true,
						message: "No matching card in area to recover",
					};
				return { ok: false, error: "No matching card in area to recover" };
			}
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
				if (effectType !== "instant")
					return {
						ok: true,
						skipped: true,
						message: "No other card in area to recover",
					};
				return { ok: false, error: "No other card in area to recover" };
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
				if (effectType !== "instant")
					return {
						ok: true,
						skipped: true,
						message: "Empty hand — cannot discard",
					};
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
				if (effectType !== "instant")
					return {
						ok: true,
						skipped: true,
						message: "No matching card in discard pile",
					};
				return { ok: false, error: "No matching card in discard pile" };
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
				if (effectType !== "instant")
					return {
						ok: true,
						skipped: true,
						message: "No matching card in hand to summon for free",
					};
				return {
					ok: false,
					error: "No matching card in hand to summon for free",
				};
			}

			// First: discard a card from hand (any card if no filter, or filtered card)
			// For Young Forest Spirit (45): discard any, summon any
			// For Dragon Egg (63): discard self (but self is already in area after instant), summon dragon
			if (sourceCardId === 63) {
				// Dragon Egg: discard self from area, summon a dragon card from hand for free
				const dragons = player.hand.filter(
					(id) =>
						CardData[id]?.family === "dragon" &&
						summonInstantFeasible(gs, player, id),
				);
				if (dragons.length === 0) {
					if (effectType !== "instant")
						return {
							ok: true,
							skipped: true,
							message: "No dragon card in hand to summon",
						};
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
								const innerResult = resolveEffect(
									gs,
									player.userId,
									chosen,
									iIdx,
									{
										payment: { red: 0, blue: 0, purple: 0 },
									},
								);
								if (innerResult.needsInteraction)
									return { ok: true, needsInteraction: true };
							}
						}
						return { ok: true };
					},
				);
			}

			// Young Forest Spirit (45): two-step — pick discard card, then pick summon card
			if (context?.phase === "pickSummon") {
				// Step 2: summon the chosen card
				const summonCardId = context.value;
				if (!summonCardId || !player.hand.includes(summonCardId)) {
					return { ok: false, error: "Invalid summon card" };
				}
				const idx = player.hand.indexOf(summonCardId);
				player.hand.splice(idx, 1);
				player.area.push(summonCardId);
				recomputePermanents(player);
				const def = CardEffectRepo[summonCardId];
				if (def) {
					const iIdx = def.effects.findIndex((e) => e.type === "instant");
					if (iIdx !== -1) {
						const innerResult = resolveEffect(
							gs,
							player.userId,
							summonCardId,
							iIdx,
							{
								payment: { red: 0, blue: 0, purple: 0 },
							},
						);
						if (innerResult.needsInteraction)
							return { ok: true, needsInteraction: true };
					}
				}
				return { ok: true };
			}

			if (context?.value !== undefined) {
				// Step 1 response: discard the chosen card, then ask which card to summon
				const discardCardId = context.value;
				if (!player.hand.includes(discardCardId)) {
					return { ok: false, error: "Invalid discard card" };
				}
				discardFromHand(gs, player, discardCardId);
				if (player.hand.length === 0) {
					return { ok: false, error: "No cards left to summon" };
				}
				const summonOptions = player.hand.filter((id) =>
					summonInstantFeasible(gs, player, id),
				);
				if (summonOptions.length === 0) {
					return { ok: false, error: "No valid card to summon for free" };
				}
				gs.pendingInteraction = {
					type: "discardThenSummon",
					forUserId: player.userId,
					cardId: sourceCardId,
					context: {
						phase: "pickSummon",
						prompt: "Summon a card for free",
						options: summonOptions,
					},
				};
				return { ok: true, needsInteraction: true };
			}

			// Step 0: ask which card to discard
			if (player.hand.length < 2) {
				if (effectType !== "instant")
					return {
						ok: true,
						skipped: true,
						message: "Need at least 2 cards in hand to discard and summon",
					};
				return {
					ok: false,
					error: "Need at least 2 cards in hand to discard and summon",
				};
			}
			gs.pendingInteraction = {
				type: "discardThenSummon",
				forUserId: player.userId,
				cardId: sourceCardId,
				context: {
					prompt: "Discard a card from your hand, then summon another for free",
					options: [...player.hand],
				},
			};
			return { ok: true, needsInteraction: true };
		}

		// ── Discard card effects ──────────────────────────────────────────────────
		case "playerDiscardCard": {
			// Two-step interaction:
			// 1. Acting player picks player
			// 2. Chosen player picks which of their filtered cards to discard
			const family = step.filter?.family;
			const playersWithCard = gs.players.filter((p) => {
				return p.area.some((id) => !family || CardData[id]?.family === family);
			});
			if (playersWithCard.length === 0) {
				// No valid targets — but if this was a summon-block-checked card, it shouldn't get here
				return { ok: true }; // skip gracefully
			}

			// Phase A: pick player
			if (!context?.targetUserId) {
				return requestInteraction(
					gs,
					player.userId,
					sourceCardId,
					"target",
					{
						prompt: family
							? `Choose a player who has a summoned ${family} card`
							: "Choose a player",
						options: playersWithCard.map((p) => p.userId),
						family,
						phase: "pickPlayer",
					},
					context,
					() => {
						return { ok: true, needsInteraction: true }; // handled outside
					},
				);
			}

			// Validate selected target is eligible (client may show stale options)
			if (!playersWithCard.some((p) => p.userId === context.targetUserId)) {
				if (playersWithCard.length === 0) return { ok: true };
				gs.pendingInteraction = {
					type: "target",
					forUserId: player.userId,
					cardId: sourceCardId,
					context: {
						prompt: family
							? `Choose a player who has a summoned ${family} card`
							: "Choose a player",
						options: playersWithCard.map((p) => p.userId),
						family,
						phase: "pickPlayer",
					},
				};
				return { ok: true, needsInteraction: true };
			}

			// Phase B: ask target to pick a card (phase C will have context.phase === "pickTargetCard")
			if (context?.phase !== "pickTargetCard") {
				const target = getPlayer(gs, context.targetUserId);
				if (!target) return { ok: false, error: "Target player not found" };
				const eligible = target.area.filter(
					(id) => !family || CardData[id]?.family === family,
				);
				if (eligible.length === 0) {
					return { ok: true }; // nothing to discard now (they might have had no card at resolution)
				}
				// Ask target player to pick
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

			// Phase C: discard the card the target chose (context.cardId or context.value holds their pick)
			const pickedCardId = context?.cardId ?? context?.value;
			const target = getPlayer(gs, context.targetUserId);
			if (!target) return { ok: false, error: "Target not found" };
			const eligible = target.area.filter(
				(id) => !family || CardData[id]?.family === family,
			);
			if (!pickedCardId || !eligible.includes(pickedCardId)) {
				return { ok: false, error: "Invalid card choice from target" };
			}
			discardFromArea(gs, target, pickedCardId);
			recomputePermanents(target);
			return { ok: true };
		}

		// ── Conditional ───────────────────────────────────────────────────────
		case "conditional": {
			const met = checkCondition(gs, player, step.condition);
			const branch = met ? (step.then ?? []) : (step.else ?? []);
			return executeSteps(
				gs,
				player,
				sourceCardId,
				branch,
				context,
				effectType,
			);
		}

		case "choice": {
			const choiceInteraction = {
				type: "choice",
				forUserId: player.userId,
				cardId: sourceCardId,
				context: {
					prompt: "Choose an option",
					options: step.options.map((o) => o.label),
				},
			};
			if (context?.choiceIndex === undefined) {
				const anyViable = step.options.some(
					(o) => !o.requireStone || (player.stones[o.requireStone] ?? 0) > 0,
				);
				if (!anyViable)
					return { ok: true, skipped: true, message: "No valid exchange option available" };
				gs.pendingInteraction = choiceInteraction;
				return { ok: true, needsInteraction: true };
			}
			const raw = context.choiceIndex;
			// Accept both numeric index and string label
			const idx =
				typeof raw === "number"
					? raw
					: step.options.findIndex((o) => o.label === raw);
			if (idx < 0 || idx >= step.options.length) {
				return { ok: false, error: "Invalid option" };
			}
			const chosen = step.options[idx];
			if (chosen.requireStone && (player.stones[chosen.requireStone] ?? 0) === 0) {
				gs.pendingInteraction = choiceInteraction;
				return { ok: false, error: `No ${chosen.requireStone} stone to exchange` };
			}
			gs.pendingInteraction = null;
			return executeSteps(
				gs,
				player,
				sourceCardId,
				chosen.steps,
				context,
				effectType,
			);
		}

		// ── Custom handlers ───────────────────────────────────────────────────
		case "custom": {
			switch (step.handler) {
				case "genie":
					return handleGenie(gs, player, resolveEffect, context);
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
		executeSteps(
			gs,
			player,
			trigger.cardId,
			trigger.steps,
			{ payment },
			"permanent",
		);
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
		executeSteps(gs, player, trigger.cardId, trigger.steps, {}, "permanent");
	}
}

// ─── Pre-summon feasibility check ────────────────────────────────────────

/**
 * For free-summon effects (YFS, Dragon Egg): checks whether a card is a valid pick.
 * Cards with no instant are always valid. Cards with instants are valid only if the instant
 * is feasible in the post-summon state (card removed from hand).
 */
function summonInstantFeasible(gs, player, id) {
	const def = CardEffectRepo[id];
	const inst = def?.effects.find((e) => e.type === "instant");
	if (!inst) return true;
	const postSummonPlayer = {
		...player,
		hand: player.hand.filter((hid) => hid !== id),
	};
	if (id === 68) {
		// Scorch: needs at least one OTHER card in area with a feasible instant
		return player.area.some((aid) => {
			const aDef = CardEffectRepo[aid];
			if (!aDef || !aDef.effects.some((e) => e.type === "instant"))
				return false;
			return isInstantFeasible(gs, postSummonPlayer, aid);
		});
	}
	return isInstantFeasible(gs, postSummonPlayer, id);
}

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
	// Scorch (68): needs at least one card in area with a currently-feasible instant effect.
	// Use the post-summon hand (Scorch removed) so hand-size checks match what handleScorch sees.
	if (cardId === 68) {
		const postSummonPlayer = {
			...player,
			hand: player.hand.filter((id) => id !== 68),
		};
		const hasFeasible = player.area.some((id) => {
			if (id === 68) return false;
			const def = CardEffectRepo[id];
			if (!def || !def.effects.some((e) => e.type === "instant")) return false;
			return isInstantFeasible(gs, postSummonPlayer, id);
		});
		if (!hasFeasible) {
			return {
				ok: false,
				error: "Cannot summon: no card in area has a usable instant effect",
			};
		}
		return { ok: true };
	}

	const blockCheck = SUMMON_BLOCK_CHECKS[cardId];
	if (!blockCheck) return { ok: true };

	const family = blockCheck.filter?.family;
	const includesSelf = blockCheck.action === "playerDiscardCard";
	const hasTarget = gs.players.some((p) => {
		if (!includesSelf && p.userId === player.userId) return false;
		return p.area.some((id) => !family || CardData[id]?.family === family);
	});
	if (!hasTarget) {
		return {
			ok: false,
			error: `Cannot summon: no ${includesSelf ? "player has" : "opponent has"} a summoned ${family} card`,
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
		if (!def.effects.some((e) => e.type === "active")) return false;
		// Genie Exalted (50): only activatable when another card with active effect exists in area
		// (can copy any active card regardless of whether it was already used this round)
		if (cardId === 50) {
			return player.area.some((id) => {
				if (id === 50) return false;
				const d = CardEffectRepo[id];
				return d && d.effects.some((e) => e.type === "active");
			});
		}
		return true;
	});
}

/**
 * Determine if a resolvable active effect exists for any unactivated card.
 */
export function hasResolvableActiveEffect(gs, player) {
	return getActivatableCards(player).length > 0;
}
