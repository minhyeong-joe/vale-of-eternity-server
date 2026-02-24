/**
 * Scorch (68) — instant: copy one instant effect from another card in your area and activate it.
 * Player selects which card's instant effect to copy via game:respond.
 */

import { CardEffectRepo } from "../repo.js";

/**
 * @param {object} gs
 * @param {object} player
 * @param {object|null} response — null for first call, { cardId } after respond
 * @param {Function} resolveEffect
 * @returns {{ ok: boolean, needsInteraction?: boolean, error?: string }}
 */
export function handleScorch(gs, player, response, resolveEffect) {
	if (!response) {
		// Ask the player which card's instant effect to copy (exclude Scorch itself)
		const options = player.area
			.filter((id) => id !== 68)
			.filter((id) => {
				const def = CardEffectRepo[id];
				return def && def.effects.some((e) => e.type === "instant");
			});

		if (options.length === 0) {
			return {
				ok: false,
				error: "No other card in area has an instant effect to copy",
			};
		}

		gs.pendingInteraction = {
			type: "choice",
			forUserId: player.userId,
			cardId: 68,
			context: { prompt: "Choose a card to copy its instant effect", options },
		};
		return { ok: true, needsInteraction: true };
	}

	// Response: run the instant effect of the chosen card
	const { cardId: targetCardId } = response;
	if (!targetCardId || !player.area.includes(targetCardId)) {
		return { ok: false, error: "Invalid card selection" };
	}
	const def = CardEffectRepo[targetCardId];
	if (!def) return { ok: false, error: "No effect definition for chosen card" };
	const eIdx = def.effects.findIndex((e) => e.type === "instant");
	if (eIdx === -1)
		return { ok: false, error: "Chosen card has no instant effect" };

	gs.pendingInteraction = null;
	// Re-run the instant as if it were fired now
	return resolveEffect(gs, player.userId, targetCardId, eIdx, null);
}
