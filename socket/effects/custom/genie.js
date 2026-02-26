/**
 * Genie (49) — instant: player picks active cards to activate one at a time, in any order.
 * Uses pendingInteraction of type "card" with phase "geniePickNext" for the picker modal.
 * When a picked card itself needs interaction, its remaining cards are parked in
 * gs.pendingGenieActivations and resumed by handleRespond after the sub-interaction resolves.
 */

import { CardEffectRepo } from "../repo.js";

/**
 * @param {object} gs
 * @param {object} player
 * @param {Function} resolveEffect
 * @param {object|null} context — null on first call; response context on subsequent calls
 */
export function handleGenie(gs, player, resolveEffect, context) {
	if (!context || context.phase !== "geniePickNext") {
		// First call: build the list of activatable cards and ask player to pick first
		const remaining = player.area.filter((cardId) => {
			if (cardId === 49) return false;
			if (player.activeEffectsUsed.includes(cardId)) return false;
			const def = CardEffectRepo[cardId];
			return def && def.effects.some((e) => e.type === "active");
		});

		if (remaining.length === 0) return { ok: true };

		gs.pendingInteraction = {
			type: "genieActivation",
			forUserId: player.userId,
			cardId: 49,
			context: {
				phase: "geniePickNext",
				prompt: "Genie — choose which card to activate",
				options: remaining,
			},
		};
		return { ok: true, needsInteraction: true };
	}

	// Subsequent call: player picked a card to activate
	const pickedCardId = context.cardId ?? context.value;
	const prevOptions = context.options ?? [];
	const remainingAfter = prevOptions.filter((id) => id !== pickedCardId);

	if (!pickedCardId || !player.area.includes(pickedCardId)) {
		return { ok: false, error: "Genie: invalid card selection" };
	}

	const def = CardEffectRepo[pickedCardId];
	if (!def) return { ok: false, error: "Genie: no effect definition" };
	const eIdx = def.effects.findIndex((e) => e.type === "active");
	if (eIdx === -1) return { ok: false, error: "Genie: card has no active effect" };

	const result = resolveEffect(gs, player.userId, pickedCardId, eIdx, null);

	if (!result.ok) {
		return { ok: false, error: result.error ?? "Genie: activation failed" };
	}

	if (result.needsInteraction) {
		// Sub-card needs interaction; park remaining cards and resume after it resolves
		gs.pendingGenieActivations = {
			remainingCardIds: remainingAfter,
			actingUserId: player.userId,
			activatingCardId: pickedCardId,
		};
		return { ok: true, needsInteraction: true };
	}

	// Sub-card resolved immediately — mark used and continue
	if (!player.activeEffectsUsed.includes(pickedCardId)) {
		player.activeEffectsUsed.push(pickedCardId);
	}

	const stillRemaining = remainingAfter.filter((id) => player.area.includes(id));
	if (stillRemaining.length > 0) {
		gs.pendingInteraction = {
			type: "genieActivation",
			forUserId: player.userId,
			cardId: 49,
			context: {
				phase: "geniePickNext",
				prompt: "Genie — choose which card to activate",
				options: stillRemaining,
			},
		};
		return { ok: true, needsInteraction: true };
	}

	return { ok: true };
}
