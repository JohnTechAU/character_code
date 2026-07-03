    // Priest
    var attack_mode=true
    var burstMpReserve = 0.6 // Only burst with skills while MP is above this fraction of max
    var burstHealThreshold = 0.65 // Priest only bursts once a party member drops below this fraction of HP (hard fight)
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
	
	// PLAYER TO SIMP FOR
	var Player = get_player("massive")
	var mostHurt = null
	var target = null

	// Healing logic
	for (var name in get_party()) {
		var member = get_player(name)
		if (member && member.rip) 
		{
			canCastSkill(member, "revive", G.skills.revive.mp, character.mp)
		}
		if (!member || member.rip) continue;
		var ratio = member.hp / member.max_hp
		if (ratio <= 0.8 && (!mostHurt || ratio < mostHurt.hp / mostHurt.max_hp)) {
			mostHurt = member
		}
	}
		if (mostHurt)
		{
			//game_log("Healing " + mostHurt.name)
			heal(mostHurt)
		}

	// Target player's target - Do not attack until Player's target is damaged
	var targetMonster = get_target_of(Player)
	if (Player && targetMonster && targetMonster.hp < targetMonster.max_hp)
	{
		target=targetMonster
	}
	else if (Player && targetMonster && targetMonster.hp == targetMonster.max_hp)
	{
		// Waiting for Player's target to be damaged — stay with him instead of fighting
		followPlayer(Player)
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
		// No fight to position for — follow only when there's no target
		followPlayer(Player)
		return;
	}

	moveToRange(target);
	if (can_attack(target)) attack(target);

	// Burst with curse only in a hard fight (a party member is hurt) and while MP is above reserve
	if (mostHurt && mostHurt.hp / mostHurt.max_hp < burstHealThreshold
		&& character.mp > character.max_mp * burstMpReserve)
		canCastSkill(target, "curse", G.skills.curse.mp, character.mp);

},1000/4); // Loops every 1/4 seconds.