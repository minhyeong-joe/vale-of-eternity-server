/**
 * Genie Exalted (50) — active: copy one active effect from another card in your area and activate it.
 * Requires player to pick which card's active effect to copy via game:respond.
 */

import { CardEffectRepo } from "../repo.js";

/**
 * Phase 1: emit interaction asking which card to copy.
 * Phase 2 (after respond): execute the chosen card's active effect.
 *
 * @param {object} gs
 * @param {object} player
 * @param {object|null} response — null for first call, { cardId } after respond
 * @param {Function} resolveEffect
 * @returns {{ ok: boolean, needsInteraction?: boolean, error?: string }}
 */
export function handleGenieExalted(gs, player, response, resolveEffect) {
	if (!response) {
		// Ask the player which card's active effect to copy
		const options = player.area
			.filter((id) => id !== 50) // can't copy Genie Exalted's own active for itself
			.filter((id) => {
				const def = CardEffectRepo[id];
				return def && def.effects.some((e) => e.type === "active");
			});

		if (options.length === 0) {
			return { ok: true }; // no targets — activateHandler will mark card as used
		}

		gs.pendingInteraction = {
			type: "card",
			forUserId: player.userId,
			cardId: 50,
			context: { prompt: "Choose a card to copy its active effect", options },
		};
		return { ok: true, needsInteraction: true };
	}

	// Response received: copy and run the active effect of the chosen card
	const { cardId: targetCardId } = response;
	if (!targetCardId || !player.area.includes(targetCardId)) {
		return { ok: false, error: "Invalid card selection" };
	}
	const def = CardEffectRepo[targetCardId];
	if (!def) return { ok: false, error: "No effect definition for chosen card" };
	const eIdx = def.effects.findIndex((e) => e.type === "active");
	if (eIdx === -1)
		return { ok: false, error: "Chosen card has no active effect" };

	gs.pendingInteraction = null;
	// Mark Genie Exalted as used now — the target has been chosen and activation is underway.
	// We do this before delegating because if the sub-card needs interaction the caller's
	// !needsInteraction guard would otherwise skip the marking entirely.
	if (!player.activeEffectsUsed.includes(50)) {
		player.activeEffectsUsed.push(50);
	}
	return resolveEffect(gs, player.userId, targetCardId, eIdx, null);
}
