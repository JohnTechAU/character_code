	// TARGETING SCRIPT
    // PLAYER TO SIMP FOR
	var Player = get_player("massive")
	
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