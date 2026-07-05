    // Hunter
    var attack_mode=true
    var burstMpReserve = 0.6 // Only burst with skills while MP is above this fraction of max
    var LEADER_NAME = "massive" // Name of the party leader to follow and support
    var TARGET_TYPE = "" // mtype to target when no leader is set (free mode) or leave blank for nearest monster
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

	var Leader = get_player(LEADER_NAME) // Re-fetched every tick so we notice when the leader goes out of sight

	// Target player's target - Do not attack until Leader's target is damaged
	var target=get_targeted_monster();
	var targetMonster = get_target_of(Leader)
	if (Leader && targetMonster && targetMonster.hp < targetMonster.max_hp)
	{
		target=targetMonster
	}
	else if (Leader && targetMonster && targetMonster.hp == targetMonster.max_hp)
	{
		// Waiting for Leader's target to be damaged — stay with him instead of fighting
		followPlayer(Leader)
		return;
	}
	else if (Leader && !targetMonster)
	{
		// Leader has no target yet — stay with him instead of fighting on our own
		followPlayer(Leader)
		return;
	}
	else if (!Leader)
	{
		if ((get_party()||{})[LEADER_NAME]) { followPlayer(LEADER_NAME); return; } // partied but out of sight — probably took a door; chase
		target = TARGET_TYPE ? get_nearest_monster({type:TARGET_TYPE}) : get_nearest_monster({min_xp:100,max_att:120});
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
		followPlayer(Leader)
		return;
	}

	moveToRange(target);
	if (can_attack(target)) attack(target);

	// Burst tanky targets with supershot, but only while MP is comfortably above reserve
	if (isSkillWorthwhile(target.max_hp, character.attack, 10)
		&& character.mp > character.max_mp * burstMpReserve)
		canCastSkill(target, "supershot", G.skills.supershot.mp, character.mp);

},1000/4); // Loops every 1/4 seconds.