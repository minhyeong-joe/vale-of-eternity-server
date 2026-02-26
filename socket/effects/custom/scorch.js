/**
 * Scorch (68) — instant: copy one instant effect from another card in your area and activate it.
 * Only shows cards whose instant effect currently has a valid target.
 */

import { CardEffectRepo, SUMMON_BLOCK_CHECKS } from "../repo.js";
import { CardData } from "../cardData.js";

/**
 * Check whether a card's instant effect is currently executable.
 * Covers three constraint types:
 *   1. playerDiscardCard — opponent must have a card of the required family in their area
 *   2. discardFromHand     — player must have ≥1 card in hand
 *   3. discardSelfSummonFree — player must have ≥2 cards in hand (YFS) or ≥1 dragon in hand (Dragon Egg)
 */
export function isInstantFeasible(gs, player, cardId) {
	// playerDiscardCard check
	const check = SUMMON_BLOCK_CHECKS[cardId];
	if (check) {
		const fam = check.filter?.family;
		const includesSelf = check.action === "playerDiscardCard";
		if (
			!gs.players.some((p) => {
				if (!includesSelf && p.userId === player.userId) return false;
				return p.area.some((id) => !fam || CardData[id]?.family === fam);
			})
		)
			return false;
	}

	// Hand requirement check
	const def = CardEffectRepo[cardId];
	const inst = def?.effects.find((e) => e.type === "instant");
	if (inst) {
		for (const step of inst.steps) {
			if (step.action === "discardFromHand" && player.hand.length === 0)
				return false;
			if (step.action === "discardSelfSummonFree") {
				if (cardId === 63) {
					if (!player.hand.some((id) => CardData[id]?.family === "dragon"))
						return false;
				} else if (player.hand.length < 2) return false;
			}
		}
	}

	return true;
}

function buildFeasibleOptions(gs, player) {
	return player.area
		.filter((id) => id !== 68)
		.filter((id) => {
			const def = CardEffectRepo[id];
			return def && def.effects.some((e) => e.type === "instant");
		})
		.filter((id) => isInstantFeasible(gs, player, id));
}

export function handleScorch(gs, player, response, resolveEffect) {
	if (!response?.cardId) {
		const options = buildFeasibleOptions(gs, player);

		if (options.length === 0) {
			return {
				ok: false,
				error: "No card in area has a usable instant effect",
			};
		}

		gs.pendingInteraction = {
			type: "card",
			forUserId: player.userId,
			cardId: 68,
			context: { prompt: "Choose a card to copy its instant effect", options },
		};
		return { ok: true, needsInteraction: true };
	}

	const { cardId: targetCardId } = response;
	if (!targetCardId || !player.area.includes(targetCardId)) {
		return { ok: false, error: "Invalid card selection" };
	}
	const def = CardEffectRepo[targetCardId];
	if (!def) return { ok: false, error: "No effect definition for chosen card" };
	const eIdx = def.effects.findIndex((e) => e.type === "instant");
	if (eIdx === -1)
		return { ok: false, error: "Chosen card has no instant effect" };

	// Re-validate feasibility at response time (state may have changed since picker was shown)
	if (!isInstantFeasible(gs, player, targetCardId)) {
		const remaining = buildFeasibleOptions(gs, player).filter(
			(id) => id !== targetCardId,
		);
		if (remaining.length === 0) {
			return { ok: false, error: "No valid instant effect to copy" };
		}
		gs.pendingInteraction = {
			type: "card",
			forUserId: player.userId,
			cardId: 68,
			context: {
				prompt: "Choose a card to copy its instant effect",
				options: remaining,
			},
		};
		return { ok: true, needsInteraction: true };
	}

	gs.pendingInteraction = null;
	return resolveEffect(gs, player.userId, targetCardId, eIdx, null);
}
