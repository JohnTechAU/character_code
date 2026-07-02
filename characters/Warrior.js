// Warrior
var attack_mode=true

	//	Working area

setInterval(function(){

	load_code(3);
	loot();

	if(!attack_mode || character.rip || is_moving(character)) return;
	
	// PLAYER TO SIMP FOR
	var Player = get_player("")

	// SELF POT
	var target=get_targeted_monster();
	checkAndUseThreshold(character.mp,character.max_mp,300,"use_mp")
	checkAndUseThreshold(character.mp,character.max_mp,100,"regen_mp")
	checkAndUseThreshold(character.hp,character.max_hp,200,"use_hp")
	checkAndUseThreshold(character.hp,character.max_hp,50,"regen_hp")
	
	// Target player's target
	var targetMonster = get_target_of(Player)
	if (targetMonster && targetMonster.hp / targetMonster.max_hp < 0.8)
	{
		target=targetMonster
	}
	else
	{
		target=get_nearest_monster({min_xp:100,max_att:120});
		if(target) change_target(target);
		else
		{
			set_message("No Monsters");
			return;
		}
	}
	
	if(!is_in_range(target))
	{
		move(
			character.x+(target.x-character.x)/2,
			character.y+(target.y-character.y)/2
			);
		// Walk half the distance
	}
	else if(can_attack(target))
	{
		set_message("Attacking");
		attack(target);
	}

},1000/4); // Loops every 1/4 seconds.
