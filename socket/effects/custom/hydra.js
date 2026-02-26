/**
 * Hydra (18) — instant: choose 2 of the 3 reward packages:
 *   A) earn 1 purple stone (6 pts)
 *   B) draw a card
 *   C) earn 2 blue stones + earn 4 score
 *
 * Player picks 2 options via game:respond { type: 'choice', value: [optA, optB] }.
 */

import { earnStones, earnScore, drawCards } from "../../store/game.js";

const OPTIONS = ["purple", "draw", "blue2", "score4"];

/**
 * @param {object} gs
 * @param {object} player
 * @param {object|null} response — null on first call; { choices: string[] } after respond
 * @returns {{ ok: boolean, needsInteraction?: boolean, error?: string }}
 */
export function handleHydra(gs, player, response) {
	if (response?.choiceIndex === undefined) {
		gs.pendingInteraction = {
			type: "choice",
			forUserId: player.userId,
			cardId: 18,
			context: {
				prompt: "Choose 2 of the 4 Hydra rewards",
				options: OPTIONS,
				pickCount: 2,
			},
		};
		return { ok: true, needsInteraction: true };
	}

	const choices = response.choiceIndex;
	if (!Array.isArray(choices) || choices.length !== 2) {
		return { ok: false, error: "Hydra: must pick exactly 2 rewards" };
	}
	const invalid = choices.filter((c) => !OPTIONS.includes(c));
	if (invalid.length > 0) {
		return {
			ok: false,
			error: `Hydra: invalid choices: ${invalid.join(", ")}`,
		};
	}
	if (choices[0] === choices[1]) {
		return { ok: false, error: "Hydra: cannot pick the same reward twice" };
	}

	gs.pendingInteraction = null;

	for (const choice of choices) {
		switch (choice) {
			case "purple":
				earnStones(player, "purple", 1);
				break;
			case "draw":
				drawCards(gs, player, 1);
				break;
			case "blue2":
				earnStones(player, "blue", 2);
				break;
			case "score4":
				earnScore(player, 4);
				break;
		}
	}

	return { ok: true };
}
