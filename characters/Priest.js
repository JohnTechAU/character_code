    // Priest
    var attack_mode=true
	load_code(1); // Utils saved in slot 1

setInterval(function(){
	loot();

	if(!attack_mode || character.rip || is_moving(character)) return;
	
	// PLAYER TO SIMP FOR
	var Player = get_player("massive")

	// Revive Player if dead
	if (Player && Player.rip)
	{
		canCastSkill(Player, "revive", G.skills.revive.mp, character.mp)
		return;
	}

	followPlayer(Player)
	
	// Healing logic
	if (Player && Player.hp / Player.max_hp <= 0.8)
	{
		heal(Player)
	}
	// HEAL ZONE END

	// SELF POT
	checkAndUseThreshold(character.mp,character.max_mp,300,"use_mp")
	checkAndUseThreshold(character.mp,character.max_mp,100,"regen_mp")
	checkAndUseThreshold(character.hp,character.max_hp,200,"use_hp")
	checkAndUseThreshold(character.hp,character.max_hp,50,"regen_hp")
	
	// Target player's target - Do not attack until Player's target is damaged
	var targetMonster = get_target_of(Player)
	if (Player && targetMonster && targetMonster.hp < targetMonster.max_hp)
	{
		target=targetMonster
	}
	else if (Player && targetMonster && targetMonster.hp == targetMonster.max_hp)
	{
		return;
	}
	else if (!Player)
	{
		target=get_nearest_monster({min_xp:100,max_att:120});
		if(target) change_target(target);
		else
		{
			set_message("No Monsters");
			return;
		}
	}
	
	if (!target)
	{
		return;
	}
	
	if(!is_in_range(target))
	{
		move(
			// Walk half the distance
			character.x+(target.x-character.x)/2,
			character.y+(target.y-character.y)/2
		);
	}
	else if(can_attack(target))
	{
		set_message("Attacking");
		attack(target);
	}

},1000/4); // Loops every 1/4 seconds.