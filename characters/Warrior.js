    // Warrior
    var attack_mode = true
    var currentTarget = null
    load_code(2); // canCastSkill saved in slot 2
    load_code(3); // checkAndUseThreshold saved in slot 3

setInterval(function(){

	loot();

	if(!attack_mode || character.rip || is_moving(character)) return;
	
	for (let id in parent.entities) {
		let entity = parent.entities[id]
		if (entity.type !== "monster" || !entity.target) continue;
		if (entity.target === character.name) continue;
		var monstersTarget = entity.target
		let victim = parent.entities[monstersTarget]
		game_log(id + " -> target: " + entity.target + " " + victim.party)
		//show_json(victim)
		if (victim.party === character.party)
		{
			//game_log(victim.name + " is in the same party as " + character.name + " attempting to taunt")
			if (!canCastSkill(entity, "taunt", G.skills.taunt.mp, character.mp)) 
			{ currentTarget = entity }
			//game_log("Casted Taunt on " + id)
		}
	}

	// PLAYER TO SIMP FOR
	var Player = get_player("")

	// SELF POT
	checkAndUseThreshold(character.mp,character.max_mp,300,"use_mp")
	checkAndUseThreshold(character.mp,character.max_mp,100,"regen_mp")
	checkAndUseThreshold(character.hp,character.max_hp,200,"use_hp")
	checkAndUseThreshold(character.hp,character.max_hp,50,"regen_hp")
	
    if (!currentTarget || currentTarget.hp <=0)
    {
        // Target player's target
        var targetMonster = get_target_of(Player)
        if (targetMonster && targetMonster.hp / targetMonster.max_hp < 0.8)
        {
            currentTarget=targetMonster
        }
        else
        {
            currentTarget=get_nearest_monster({min_xp:100,max_att:1200});
            if(currentTarget) change_target(currentTarget);
            else
            {
                set_message("No Monsters");
                return;
            }
        }
	}
            if(!is_in_range(currentTarget))
        {
            move(
                character.x+(currentTarget.x-character.x)/2,
                character.y+(currentTarget.y-character.y)/2
                );
            // Walk half the distance
        }
        else if(can_attack(currentTarget))
        {
            set_message("Attacking");
            attack(currentTarget);
        }
},1000/4); // Loops every 1/4 seconds.
