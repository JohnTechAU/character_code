    // Warrior
    var attack_mode = true
    var target = null
    var TARGET_TYPE = "croc" // mtype of monster to target or leave blank for nearest monster; overridden by FARM_MODE
    var LEADER_NAME = "" // Name of the party leader to taunt/support for; blank = free mode (just fight TARGET_TYPE, no taunting)
    var FARM_MODE = true // Cycle through zones[ZONE] in order, farming each type down to level 1 before moving on
    var ZONE = "main" // Zone to farm: main | winterland | desertland (see shared/zones.js)
    var ZONE_ORDER = "efficient" // "efficient" (nearest-neighbor route by spawn coordinates) | "random"
    var farmIndex = 0
    var farmList = null // cached order of types to farm, built once from ZONE_ORDER on first use (see shared/zones.js)
    var farmLocations = []   // cached spawn-region centers for TARGET_TYPE (a mob can have several, e.g. bees)
    var farmLocIndex = 0     // which farmLocations entry we're currently headed to/farming
    var farmLocType = null   // TARGET_TYPE farmLocations was computed for (cache-invalidation key)
    var farmStuckSince = null // when we started traveling toward farmLocIndex with nothing visible there
    load_code(1); // Utils saved in slot 1
    load_code(2); // Movement saved in slot 2
    load_code(3); // Zones saved in slot 3

setInterval(function(){

	loot();

	// SELF POT - above the moving check so we keep potting while traveling
	checkAndUseThreshold(character.mp,character.max_mp,300,"use_mp")
	checkAndUseThreshold(character.mp,character.max_mp,100,"regen_mp")
	checkAndUseThreshold(character.hp,character.max_hp,200,"use_hp")
	checkAndUseThreshold(character.hp,character.max_hp,50,"regen_hp")

	if(!attack_mode || character.rip || is_moving(character)) return;

    // FARM MODE - cycle through zones[ZONE], farming each type down to level 1 before advancing.
    // Skipped while movement.js is already driving a route (e.g. mid-travel to the next group).
	if (FARM_MODE && typeof movement !== "undefined" && !movement.active()) {
		if (!farmList) {
			farmList = ZONE_ORDER === "random" ? buildRandomOrder(ZONE) : buildEfficientOrder(ZONE, character);
		}
		if (farmList.length) {
			TARGET_TYPE = farmList[farmIndex % farmList.length];

			// Recompute known spawn locations only when TARGET_TYPE changed. Sorted nearest-first
			// from wherever the character is right now (i.e. wherever farming the previous type
			// left off), so a type with several spawn regions (e.g. bees) is visited in the order
			// that's closest to walk, not the order the map data happens to list them in.
			if (farmLocType !== TARGET_TYPE) {
				farmLocations = findZoneGroupLocations(ZONE, TARGET_TYPE).sort(function (a, b) {
					return distance(character, a) - distance(character, b);
				});
				farmLocIndex = 0;
				farmLocType = TARGET_TYPE;
				farmStuckSince = null;
			}

			// ARRIVAL_RANGE only answers "am I close enough to farmLocations[farmLocIndex] to
			// call this location visited" — it drives the stuck-timer/rotate-location logic
			// below, nothing else. Bee has ~3 spawn regions close enough together that the old
			// single NEARBY_RANGE=400 also got used (wrongly) to decide "is this type farmed
			// out", which let a level>1 straggler in one region block progress forever while the
			// character kept killing easy level-1 spawns in another. The hunt scan below is
			// deliberately NOT range-limited: a monster stays "unfarmed" no matter which of the
			// type's spawn regions it's actually in.
			var ARRIVAL_RANGE = 150;
			var anyNearby = false;
			var huntTarget = null;
			var huntDist = null;
			for (let id in parent.entities) {
				let e = parent.entities[id];
				if (e.type !== "monster" || e.mtype !== TARGET_TYPE || e.rip) continue;
				if (distance(character, e) <= ARRIVAL_RANGE) anyNearby = true;
				if (e.level > 1) {
					let d = distance(character, e);
					if (huntTarget === null || d < huntDist) { huntTarget = e; huntDist = d; }
				}
			}
			if (!anyNearby) {
				if (farmLocations.length) {
					// Stuck escape: if nothing has become visible at this location for too
					// long (bad boundary data, or nothing has respawned there), stop
					// waiting on it and move to the next known location for this type.
					if (farmStuckSince === null) farmStuckSince = Date.now();
					if (Date.now() - farmStuckSince > 45000 && farmLocations.length > 1) {
						farmLocIndex = (farmLocIndex + 1) % farmLocations.length;
						farmStuckSince = Date.now();
					}
					var loc = farmLocations[farmLocIndex % farmLocations.length];
					smart_move(loc);
					set_message(TARGET_TYPE + (farmLocations.length > 1 ? " (" + (farmLocIndex + 1) + "/" + farmLocations.length + ")" : ""));
				} else {
					set_message(TARGET_TYPE + " (no location)");
				}
				return;
			} else if (huntTarget) {
				// Something of this type is still above level 1 — walk straight to it (via the
				// shared moveToRange/attack below, which pathfinds through smart_move when it's
				// not in a direct line) instead of passively fighting whatever's nearest.
				farmStuckSince = null;
				target = huntTarget;
				set_message("Hunting " + TARGET_TYPE + " (lvl " + huntTarget.level + ")");
				// Fall through: no return here, so the shared target-revalidation/moveToRange/
				// attack logic at the bottom of the loop actually drives movement and combat.
			} else {
				farmStuckSince = null;
				// Everything known of this type is level <= 1 — farmed out. Visit every known
				// location for this type before moving on to the next type.
				if (farmLocIndex + 1 < farmLocations.length) {
					farmLocIndex++;
				} else {
					farmIndex = (farmIndex + 1) % farmList.length;
					farmLocType = null; // force recompute of locations for the new TARGET_TYPE
				}
				target = null;
				return;
			}
		}
	}

    // Taunting Logic - Taunt monsters that are attacking party members (group mode only)
	if (LEADER_NAME) for (let id in parent.entities) {
		let entity = parent.entities[id]
		if (entity.type !== "monster" || !entity.target) continue;
		if (entity.target === character.name) continue;
		var monstersTarget = entity.target
		let victim = parent.entities[monstersTarget]
		if (!victim) continue;
		//show_json(victim)
		if (victim.party === character.party)
		{
			//game_log(victim.name + " is in the same party as " + character.name + " attempting to taunt")
			if (!canCastSkill(entity, "taunt", G.skills.taunt.mp, character.mp))
			{ target = entity }
			//game_log("Casted Taunt on " + id)
		}
	}

	// PLAYER TO SIMP FOR
	var Player = get_player(LEADER_NAME)

    if (target)
    {
        target = get_entity(target.id)
        if (!target || target.rip)
        {
            target = null
        }
    }
	
    if (!target)
    {
        // Target player's target
        var targetMonster = get_target_of(Player)
        if (targetMonster && targetMonster.hp / targetMonster.max_hp < 0.8)
        {
            target=targetMonster
        }
        else
        {
            target = TARGET_TYPE ? get_nearest_monster({type:TARGET_TYPE}) : get_nearest_monster({min_xp:100,max_att:1200});
            if(target) change_target(target);
            else
            {
                set_message("No Monsters");
                return;
            }
        }
	}

    	moveToRange(target);
	if (can_attack(target)) attack(target);

},1000/4); // Loops every 1/4 seconds.
