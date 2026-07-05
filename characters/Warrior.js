    // Warrior
    var attack_mode = true
    var target = null
    var TARGET_TYPE = "croc" // mtype of monster to target or leave blank for nearest monster; overridden by FARM_MODE
    var LEADER_NAME = "" // Name of the party leader to taunt/support for; blank = free mode (just fight TARGET_TYPE, no taunting)
    var FARM_MODE = true // Cycle through zones[ZONE] in order, farming each type down to level 1 before moving on
    var ZONE = "main" // Zone to farm: main | winterland | desertland (see shared/zones.js)
    var farmIndex = 0
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
		var farmList = zones[ZONE] || [];
		if (farmList.length) {
			TARGET_TYPE = farmList[farmIndex % farmList.length];

			// Recompute known spawn locations only when TARGET_TYPE changed.
			if (farmLocType !== TARGET_TYPE) {
				farmLocations = findZoneGroupLocations(ZONE, TARGET_TYPE);
				farmLocIndex = 0;
				farmLocType = TARGET_TYPE;
				farmStuckSince = null;
			}

			// Only count monsters actually close enough to fight in place as "visible" — the
			// engine's parent.entities (and get_nearest_monster) can know about monsters on the
			// far side of the map (e.g. bees' other spawn points), and moveToRange below moves in
			// a straight line with no pathfinding, so treating a distant monster as "visible"
			// causes the character to walk straight at it and get stuck on terrain instead of
			// using smart_move's pathfinding to travel there first.
			var NEARBY_RANGE = 400;
			var visible = [];
			for (let id in parent.entities) {
				let e = parent.entities[id];
				if (e.type === "monster" && e.mtype === TARGET_TYPE && !e.rip && distance(character, e) <= NEARBY_RANGE) visible.push(e);
			}
			if (!visible.length) {
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
			} else if (visible.every(function (e) { return e.level <= 1; })) {
				farmStuckSince = null;
				// Visit every known location for this type before moving on to the next type.
				if (farmLocIndex + 1 < farmLocations.length) {
					farmLocIndex++;
				} else {
					farmIndex = (farmIndex + 1) % farmList.length;
					farmLocType = null; // force recompute of locations for the new TARGET_TYPE
				}
				target = null;
				return;
			} else {
				farmStuckSince = null;
				set_message("Farming " + TARGET_TYPE);
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
