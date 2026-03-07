/**
 * DSL definitions for all 70 Vale of Eternity cards.
 *
 * Each card has an `effects` array with one or more effect objects.
 * Each effect has a `type` ('instant' | 'permanent' | 'active') and `steps`.
 * Permanent effects are applied once on summon and removed when the card leaves the area.
 * Instant effects fire when the card is summoned.
 * Active effects fire during the resolution phase when activated.
 *
 * The resolution engine (effects/index.js) interprets these step objects.
 */

export const CardEffectRepo = {
	// ── Fire ────────────────────────────────────────────────────────────────

	// Agni (1) — permanent: red stone value +1
	1: {
		effects: [
			{
				type: "permanent",
				steps: [{ action: "stoneValueBonus", stoneType: "red", bonus: 1 }],
			},
		],
	},

	// Asmodeus (2) — active: recover a card with instant + written cost ≤ 2
	2: {
		effects: [
			{
				type: "active",
				steps: [
					{
						action: "recoverTarget",
						filter: { effectType: "instant", costMax: 2 },
					},
				],
			},
		],
	},

	// Balog (3) — active: recover a fire card with instant
	3: {
		effects: [
			{
				type: "active",
				steps: [
					{
						action: "recoverTarget",
						filter: { family: "fire", effectType: "instant" },
					},
				],
			},
		],
	},

	// Burning Skull (4) — active: discard 1 red stone, earn score 3
	4: {
		effects: [
			{
				type: "active",
				steps: [
					{ action: "discardStone", stoneType: "red" },
					{ action: "earnScore", amount: 3 },
				],
			},
		],
	},

	// Firefox (5) — instant: earn score 1 per card in hand
	5: {
		effects: [
			{
				type: "instant",
				steps: [
					{
						action: "earnScorePer",
						amount: 1,
						scope: { location: "hand", owner: "self" },
					},
				],
			},
		],
	},

	// Hestia (6) — permanent: +2 stone capacity
	6: {
		effects: [
			{
				type: "permanent",
				steps: [{ action: "stoneCapacityBonus", amount: 2 }],
			},
		],
	},

	// Horned Salamander (7) — active: earn 4 red stones
	7: {
		effects: [
			{
				type: "active",
				steps: [{ action: "earnStone", stoneType: "red", count: 4 }],
			},
		],
	},

	// Ifrit (8) — instant: earn score 1 per card in area
	8: {
		effects: [
			{
				type: "instant",
				steps: [
					{
						action: "earnScorePer",
						amount: 1,
						scope: { location: "area", owner: "self" },
					},
				],
			},
		],
	},

	// Imp (9) — instant: earn 2 red stones; active: recover self
	9: {
		effects: [
			{
				type: "instant",
				steps: [{ action: "earnStone", stoneType: "red", count: 2 }],
			},
			{ type: "active", steps: [{ action: "recover" }] },
		],
	},

	// Incubus (10) — instant: earn score 2 per card with cost ≤ 2 in area
	10: {
		effects: [
			{
				type: "instant",
				steps: [
					{
						action: "earnScorePer",
						amount: 2,
						scope: { location: "area", owner: "self", filter: { costMax: 2 } },
					},
				],
			},
		],
	},

	// Lava Giant (11) — instant: earn score 2 per fire card in area (includes self)
	11: {
		effects: [
			{
				type: "instant",
				steps: [
					{
						action: "earnScorePer",
						amount: 2,
						scope: {
							location: "area",
							owner: "self",
							filter: { family: "fire" },
						},
					},
				],
			},
		],
	},

	// Phoenix (12) — permanent: whenever you summon, earn score 1 per red stone paid
	12: {
		effects: [
			{
				type: "permanent",
				steps: [
					{
						action: "trigger",
						when: "onSummon",
						condition: null,
						steps: [{ action: "earnScorePerPaidStone", stoneType: "red" }],
					},
				],
			},
		],
	},

	// Salamander (13) — active: earn 1 red stone + 1 score
	13: {
		effects: [
			{
				type: "active",
				steps: [
					{ action: "earnStone", stoneType: "red", count: 1 },
					{ action: "earnScore", amount: 1 },
				],
			},
		],
	},

	// Succubus (14) — instant: if cards with costs 1–4 all in area, earn score 10
	14: {
		effects: [
			{
				type: "instant",
				steps: [
					{
						action: "conditional",
						condition: { check: "allCostsPresentInArea", costs: [1, 2, 3, 4] },
						then: [{ action: "earnScore", amount: 10 }],
						else: [],
					},
				],
			},
		],
	},

	// Surtr (15) — instant: earn score 2 per distinct family in area
	15: {
		effects: [
			{
				type: "instant",
				steps: [
					{
						action: "earnScorePerFamily",
						amount: 2,
						scope: { location: "area", owner: "self" },
					},
				],
			},
		],
	},

	// ── Water ───────────────────────────────────────────────────────────────

	// Charybdis (16) — active: discard 1 blue stone, earn score 5
	16: {
		effects: [
			{
				type: "active",
				steps: [
					{ action: "discardStone", stoneType: "blue" },
					{ action: "earnScore", amount: 5 },
				],
			},
		],
	},

	// Hae-tae (17) — permanent: blue ↔ purple value swap
	17: {
		effects: [
			{
				type: "permanent",
				steps: [
					{ action: "stoneOverride", from: "blue", countsAs: "purple" },
					{ action: "stoneOverride", from: "purple", countsAs: "blue" },
				],
			},
		],
	},

	// Hydra (18) — instant: custom (choose 2 of 3 rewards)
	18: {
		effects: [
			{ type: "instant", steps: [{ action: "custom", handler: "hydra" }] },
		],
	},

	// Kappa (19) — permanent: whenever you summon using blue stone, earn score 2 (NOT for its own summon)
	19: {
		effects: [
			{
				type: "permanent",
				steps: [
					{
						action: "trigger",
						when: "onSummon",
						condition: { check: "paymentUsedStone", stoneType: "blue" },
						steps: [{ action: "earnScore", amount: 2 }],
					},
				],
			},
		],
	},

	// Leviathan (20) — instant: earn 7; player discards a summoned dragon card
	20: {
		effects: [
			{
				type: "instant",
				steps: [
					{ action: "playerDiscardCard", filter: { family: "dragon" } },
					{ action: "earnScore", amount: 7 },
				],
			},
		],
	},

	// Nessie (21) — active: if no dragon in area, earn score 2
	21: {
		effects: [
			{
				type: "active",
				steps: [
					{
						action: "conditional",
						condition: { check: "noFamilyInArea", family: "dragon" },
						then: [{ action: "earnScore", amount: 2 }],
						else: [],
					},
				],
			},
		],
	},

	// Poseidon (22) — instant: earn score 3 per water card in area
	22: {
		effects: [
			{
				type: "instant",
				steps: [
					{
						action: "earnScorePer",
						amount: 3,
						scope: {
							location: "area",
							owner: "self",
							filter: { family: "water" },
						},
					},
				],
			},
		],
	},

	// Sea Spirit (23) — active: earn score 1 per blue stone (count, not value)
	23: {
		effects: [
			{
				type: "active",
				steps: [
					{
						action: "earnScore",
						amount: { compute: "stoneCount", stoneType: "blue" },
					},
				],
			},
		],
	},

	// Snail Maiden (24) — active: choice between two stone exchanges
	24: {
		effects: [
			{
				type: "active",
				steps: [
					{
						action: "choice",
						options: [
							{
								label: "Exchange 1 blue → 1 purple",
								requireStone: "blue",
								steps: [
									{
										action: "exchangeStone",
										from: "blue",
										to: "purple",
										count: 1,
									},
								],
							},
							{
								label: "Exchange 1 purple → 3 blue",
								requireStone: "purple",
								steps: [
									{
										action: "exchangeStone",
										from: "purple",
										to: "blue",
										count: 3,
									},
								],
							},
						],
					},
				],
			},
		],
	},

	// Triton (25) — permanent: whenever you tame a water card, earn 2 blue stones
	25: {
		effects: [
			{
				type: "permanent",
				steps: [
					{
						action: "trigger",
						when: "onTame",
						condition: { check: "tamedCardFamily", family: "water" },
						steps: [{ action: "earnStone", stoneType: "blue", count: 2 }],
					},
				],
			},
		],
	},

	// Undine (26) — instant: earn 1 blue stone; active: recover self
	26: {
		effects: [
			{
				type: "instant",
				steps: [{ action: "earnStone", stoneType: "blue", count: 1 }],
			},
			{ type: "active", steps: [{ action: "recover" }] },
		],
	},

	// Undine Queen (27) — active: earn 1 blue stone
	27: {
		effects: [
			{
				type: "active",
				steps: [{ action: "earnStone", stoneType: "blue", count: 1 }],
			},
		],
	},

	// Water Giant (28) — instant: earn 2 blue; permanent: blue+purple value +1 each
	28: {
		effects: [
			{
				type: "instant",
				steps: [{ action: "earnStone", stoneType: "blue", count: 2 }],
			},
			{
				type: "permanent",
				steps: [
					{ action: "stoneValueBonus", stoneType: "blue", bonus: 1 },
					{ action: "stoneValueBonus", stoneType: "purple", bonus: 1 },
				],
			},
		],
	},

	// Yuki Onna (29) — instant: earn score = total stone value, then discard all stones
	29: {
		effects: [
			{
				type: "instant",
				steps: [
					{ action: "earnScore", amount: { compute: "stoneTotal" } },
					{ action: "discardStone", stoneType: "all" },
				],
			},
		],
	},

	// Yuki Onna Exalted (30) — instant: earn score = total value of blue stones (count × 3+bonus)
	30: {
		effects: [
			{
				type: "instant",
				steps: [
					{
						action: "earnScore",
						amount: { compute: "stoneTotal", stoneType: "blue" },
					},
				],
			},
		],
	},

	// ── Earth ───────────────────────────────────────────────────────────────

	// Basilisk (31) — active: choice: lose 0/1/2 pts, earn red/blue/purple stone
	31: {
		effects: [
			{
				type: "active",
				steps: [
					{
						action: "choice",
						options: [
							{
								label: "Lose 0, earn red",
								steps: [{ action: "earnStone", stoneType: "red", count: 1 }],
							},
							{
								label: "Lose 1, earn blue",
								steps: [
									{ action: "loseScore", amount: 1 },
									{ action: "earnStone", stoneType: "blue", count: 1 },
								],
							},
							{
								label: "Lose 2, earn purple",
								steps: [
									{ action: "loseScore", amount: 2 },
									{ action: "earnStone", stoneType: "purple", count: 1 },
								],
							},
						],
					},
				],
			},
		],
	},

	// Behemoth (32) — instant: earn score 3 per distinct family in area
	32: {
		effects: [
			{
				type: "instant",
				steps: [
					{
						action: "earnScorePerFamily",
						amount: 3,
						scope: { location: "area", owner: "self" },
					},
				],
			},
		],
	},

	// Cerberus (33) — instant: discard up to 3 of your other summoned cards
	33: {
		effects: [
			{ type: "instant", steps: [{ action: "discardFromArea", maxCount: 3 }] },
		],
	},

	// Forest Spirit (34) — instant: discard a card from hand, earn score = its written cost
	34: {
		effects: [
			{
				type: "instant",
				steps: [{ action: "discardFromHand", then: { earnCost: true } }],
			},
		],
	},

	// Gargoyle (35) — permanent: whenever you summon using purple stone, earn score 3
	35: {
		effects: [
			{
				type: "permanent",
				steps: [
					{
						action: "trigger",
						when: "onSummon",
						condition: { check: "paymentUsedStone", stoneType: "purple" },
						steps: [{ action: "earnScore", amount: 3 }],
					},
				],
			},
		],
	},

	// Goblin (36) — active: steal score 1 from chosen opponent
	36: {
		effects: [{ type: "active", steps: [{ action: "stealScore", amount: 1 }] }],
	},

	// Goblin Soldier (37) — active: if any opponent has more score, earn 4; else lose 4
	37: {
		effects: [
			{
				type: "active",
				steps: [
					{
						action: "conditional",
						condition: { check: "opponentHasMoreScore" },
						then: [{ action: "earnScore", amount: 4 }],
						else: [{ action: "loseScore", amount: 4 }],
					},
				],
			},
		],
	},

	// Medusa (38) — active: discard a card from hand, earn 1 purple stone
	38: {
		effects: [
			{
				type: "active",
				steps: [
					{ action: "discardFromHand" },
					{ action: "earnStone", stoneType: "purple", count: 1 },
				],
			},
		],
	},

	// Mimic (39) — active: take an earth card from discard pile into hand
	39: {
		effects: [
			{
				type: "active",
				steps: [{ action: "fromDiscardToHand", filter: { family: "earth" } }],
			},
		],
	},

	// Mud Slime (40) — instant: earn score 6; active: recover self
	40: {
		effects: [
			{ type: "instant", steps: [{ action: "earnScore", amount: 6 }] },
			{ type: "active", steps: [{ action: "recover" }] },
		],
	},

	// Rock Golem (41) — instant: earn score = total value of purple stones
	41: {
		effects: [
			{
				type: "instant",
				steps: [
					{
						action: "earnScore",
						amount: { compute: "stoneTotal", stoneType: "purple" },
					},
				],
			},
		],
	},

	// Sand Giant (42) — instant: earn score 4 per earth card in area
	42: {
		effects: [
			{
				type: "instant",
				steps: [
					{
						action: "earnScorePer",
						amount: 4,
						scope: {
							location: "area",
							owner: "self",
							filter: { family: "earth" },
						},
					},
				],
			},
		],
	},

	// Stone Golem (43) — instant: exchange all stones → purple
	43: {
		effects: [
			{ type: "instant", steps: [{ action: "exchangeAllStonesToPurple" }] },
		],
	},

	// Troll (44) — active: if has purple stone, earn score 3
	44: {
		effects: [
			{
				type: "active",
				steps: [
					{
						action: "conditional",
						condition: { check: "hasStone", stoneType: "purple" },
						then: [{ action: "earnScore", amount: 3 }],
						else: [],
					},
				],
			},
		],
	},

	// Young Forest Spirit (45) — instant: discard a card from hand, summon another for free
	45: {
		effects: [
			{ type: "instant", steps: [{ action: "discardSelfSummonFree" }] },
		],
	},

	// ── Wind ────────────────────────────────────────────────────────────────

	// Boreas (46) — instant: earn score 1 per wind card in area (counts self), then recover self
	46: {
		effects: [
			{
				type: "instant",
				steps: [
					{
						action: "earnScorePer",
						amount: 1,
						scope: {
							location: "area",
							owner: "self",
							filter: { family: "wind" },
						},
					},
					{ action: "recover" },
				],
			},
		],
	},

	// Dandelion Spirit (47) — instant: draw a card; active: recover self
	47: {
		effects: [
			{ type: "instant", steps: [{ action: "draw", count: 1 }] },
			{ type: "active", steps: [{ action: "recover" }] },
		],
	},

	// Freyja (48) — active: earn score 1 per card with active effect in area
	48: {
		effects: [
			{
				type: "active",
				steps: [
					{
						action: "earnScorePer",
						amount: 1,
						scope: {
							location: "area",
							owner: "self",
							filter: { effectType: "active" },
						},
					},
				],
			},
		],
	},

	// Genie (49) — instant: activate all available active effects in area (custom)
	49: {
		effects: [
			{ type: "instant", steps: [{ action: "custom", handler: "genie" }] },
		],
	},

	// Genie Exalted (50) — active: copy one active effect from another card in area (custom)
	50: {
		effects: [
			{
				type: "active",
				steps: [{ action: "custom", handler: "genieExalted" }],
			},
		],
	},

	// Gi-rin (51) — instant: earn score 2 per card in area
	51: {
		effects: [
			{
				type: "instant",
				steps: [
					{
						action: "earnScorePer",
						amount: 2,
						scope: { location: "area", owner: "self" },
					},
				],
			},
		],
	},

	// Griffon (52) — active: draw a card
	52: { effects: [{ type: "active", steps: [{ action: "draw", count: 1 }] }] },

	// Harpy (53) — active: if hand count equals area count, earn score 3
	53: {
		effects: [
			{
				type: "active",
				steps: [
					{
						action: "conditional",
						condition: { check: "handEqualsAreaCount" },
						then: [{ action: "earnScore", amount: 3 }],
						else: [],
					},
				],
			},
		],
	},

	// Hippogriff (54) — instant: draw a card; permanent: wind cards cost -2
	54: {
		effects: [
			{ type: "instant", steps: [{ action: "draw", count: 1 }] },
			{
				type: "permanent",
				steps: [{ action: "costReduction", family: "wind", amount: 2 }],
			},
		],
	},

	// Odin (55) — active: if hand < 6, earn score 2; else earn 1 purple stone
	55: {
		effects: [
			{
				type: "active",
				steps: [
					{
						action: "conditional",
						condition: { check: "handLessThan", count: 6 },
						then: [{ action: "earnScore", amount: 2 }],
						else: [{ action: "earnStone", stoneType: "purple", count: 1 }],
					},
				],
			},
		],
	},

	// Pegasus (56) — instant: draw a card; permanent: all cards cost -1
	56: {
		effects: [
			{ type: "instant", steps: [{ action: "draw", count: 1 }] },
			{ type: "permanent", steps: [{ action: "costReduction", amount: 1 }] },
		],
	},

	// Rudra (57) — instant: earn score 2 per card in hand
	57: {
		effects: [
			{
				type: "instant",
				steps: [
					{
						action: "earnScorePer",
						amount: 2,
						scope: { location: "hand", owner: "self" },
					},
				],
			},
		],
	},

	// Sylph (58) — instant: draw a card; permanent: whenever summon, earn score 1
	58: {
		effects: [
			{ type: "instant", steps: [{ action: "draw", count: 1 }] },
			{
				type: "permanent",
				steps: [
					{
						action: "trigger",
						when: "onSummon",
						condition: null,
						steps: [{ action: "earnScore", amount: 1 }],
					},
				],
			},
		],
	},

	// Tengu (59) — instant: earn score 6; put self on top of draw deck
	59: {
		effects: [
			{
				type: "instant",
				steps: [
					{ action: "earnScore", amount: 6 },
					{ action: "putSelfOnDeck" },
				],
			},
		],
	},

	// Valkyrie (60) — active: earn score 1 per distinct family in area
	60: {
		effects: [
			{
				type: "active",
				steps: [
					{
						action: "earnScorePerFamily",
						amount: 1,
						scope: { location: "area", owner: "self" },
					},
				],
			},
		],
	},

	// ── Dragon ──────────────────────────────────────────────────────────────

	// Aeris (61) — instant: recover another card, earn score = its written cost
	61: {
		effects: [{ type: "instant", steps: [{ action: "recoverEarnCost" }] }],
	},

	// Boulder (62) — instant: earn score 8; player discards a wind card
	62: {
		effects: [
			{
				type: "instant",
				steps: [
					{ action: "playerDiscardCard", filter: { family: "wind" } },
					{ action: "earnScore", amount: 8 },
				],
			},
		],
	},

	// Dragon Egg (63) — instant: discard self, summon a dragon card from hand for free
	63: {
		effects: [
			{
				type: "instant",
				steps: [
					{ action: "discardSelfSummonFree", filter: { family: "dragon" } },
				],
			},
		],
	},

	// Ember (64) — instant: earn score 7; player discards a water card
	// Blocked if no player has a summoned water card
	64: {
		effects: [
			{
				type: "instant",
				steps: [
					{ action: "playerDiscardCard", filter: { family: "water" } },
					{ action: "earnScore", amount: 7 },
				],
			},
		],
	},

	// Eternity (65) — instant: earn score 4 per distinct family in area (counts self = dragon)
	65: {
		effects: [
			{
				type: "instant",
				steps: [
					{
						action: "earnScorePerFamily",
						amount: 4,
						scope: { location: "area", owner: "self" },
					},
				],
			},
		],
	},

	// Gust (66) — instant: earn score 8; player discards an earth card
	66: {
		effects: [
			{
				type: "instant",
				steps: [
					{ action: "playerDiscardCard", filter: { family: "earth" } },
					{ action: "earnScore", amount: 8 },
				],
			},
		],
	},

	// Marina (67) — instant: earn score 7; player discards a fire card
	67: {
		effects: [
			{
				type: "instant",
				steps: [
					{ action: "playerDiscardCard", filter: { family: "fire" } },
					{ action: "earnScore", amount: 7 },
				],
			},
		],
	},

	// Scorch (68) — instant: copy one instant effect from another card in area (custom)
	68: {
		effects: [
			{ type: "instant", steps: [{ action: "custom", handler: "scorch" }] },
		],
	},

	// Tidal (69) — instant: earn score 5 per dragon card in area
	69: {
		effects: [
			{
				type: "instant",
				steps: [
					{
						action: "earnScorePer",
						amount: 5,
						scope: {
							location: "area",
							owner: "self",
							filter: { family: "dragon" },
						},
					},
				],
			},
		],
	},

	// Willow (70) — instant: earn 1 red + 1 blue + 1 purple stone + score 3; draw a card
	70: {
		effects: [
			{
				type: "instant",
				steps: [
					{ action: "earnStone", stoneType: "red", count: 1 },
					{ action: "earnStone", stoneType: "blue", count: 1 },
					{ action: "earnStone", stoneType: "purple", count: 1 },
					{ action: "earnScore", amount: 3 },
					{ action: "draw", count: 1 },
				],
			},
		],
	},
};

/**
 * Cards whose instant summon is blocked if no target exists (playerDiscardCard).
 * Used for pre-summon feasibility checks.
 */
export const SUMMON_BLOCK_CHECKS = {
	20: { action: "playerDiscardCard", filter: { family: "dragon" } },
	62: { action: "playerDiscardCard", filter: { family: "wind" } },
	64: { action: "playerDiscardCard", filter: { family: "water" } },
	66: { action: "playerDiscardCard", filter: { family: "earth" } },
	67: { action: "playerDiscardCard", filter: { family: "fire" } },
};
