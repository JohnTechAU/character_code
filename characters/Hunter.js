    // Hunter
    var attack_mode=true
    var burstMpReserve = 0.6 // Only burst with skills while MP is above this fraction of max
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

	// Target player's target - Do not attack until Player's target is damaged
	var target=get_targeted_monster();
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
		if ((get_party()||{})["massive"]) { followPlayer("massive"); return; } // partied but out of sight — probably took a door; chase
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

	// Burst tanky targets with supershot, but only while MP is comfortably above reserve
	if (isSkillWorthwhile(target.max_hp, character.attack, 10)
		&& character.mp > character.max_mp * burstMpReserve)
		canCastSkill(target, "supershot", G.skills.supershot.mp, character.mp);

},1000/4); // Loops every 1/4 seconds.