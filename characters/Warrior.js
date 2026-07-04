    // Warrior
    var attack_mode = true
    var target = null
    var TARGET_TYPE = "croc" // mtype of monster to target or leave blank for nearest monster
    load_code(1); // Utils saved in slot 1
    load_code(2); // Movement saved in slot 2

setInterval(function(){

	loot();

	// SELF POT - above the moving check so we keep potting while traveling
	checkAndUseThreshold(character.mp,character.max_mp,300,"use_mp")
	checkAndUseThreshold(character.mp,character.max_mp,100,"regen_mp")
	checkAndUseThreshold(character.hp,character.max_hp,200,"use_hp")
	checkAndUseThreshold(character.hp,character.max_hp,50,"regen_hp")

	if(!attack_mode || character.rip || is_moving(character)) return;
	
    // Taunting Logic - Taunt monsters that are attacking party members
	for (let id in parent.entities) {
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
	var Player = get_player("")

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
