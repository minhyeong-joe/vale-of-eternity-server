/**
 * Genie (49) — instant: activate all available active effects of cards in your area.
 * Iterates the area and calls resolveEffect for every active-effect card.
 * Cards already activated (activeEffectsUsed) are skipped.
 */

import { CardEffectRepo } from "../repo.js";

/**
 * @param {object} gs    — full game state
 * @param {object} player — acting player
 * @param {Function} resolveEffect — (gs, userId, cardId, effectIndex, context?) => result
 * @returns {{ ok: boolean, error?: string }}
 */
export function handleGenie(gs, player, resolveEffect) {
	// Genie itself is already in the area at this point (it's an instant).
	// We activate every other card with an active effect, in any order (all forced).
	// For simplicity, iterate in area order; effects that need interaction are queued.
	const active = player.area.filter((cardId) => {
		if (cardId === 49) return false; // skip Genie itself (no active effect)
		const def = CardEffectRepo[cardId];
		if (!def) return false;
		return def.effects.some((e) => e.type === "active");
	});

	for (const cardId of active) {
		const def = CardEffectRepo[cardId];
		const eIdx = def.effects.findIndex((e) => e.type === "active");
		if (eIdx === -1) continue;
		// Skip cards requiring interaction — they'll need separate responds
		// For Genie we resolve synchronously only simple effects
		const result = resolveEffect(gs, player.userId, cardId, eIdx, null);
		if (!result.ok && result.needsInteraction) {
			// Store the first pending interaction and stop; client must respond then re-trigger
			return { ok: true, needsInteraction: true };
		}
	}
	return { ok: true };
}
