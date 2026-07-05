    // Priest
    var attack_mode=true
    var burstMpReserve = 0.6 // Only burst with skills while MP is above this fraction of max
    var burstHealThreshold = 0.65 // Priest only bursts once a party member drops below this fraction of HP (hard fight)
	var LEADER_NAME = "massive" // Name of the party leader to follow and support
	var TARGET_TYPE = "" // mtype to target when no leader is set (free mode) or leave blank for nearest monster
	var REVIVE_RANGE = 250 // Cast range for revive; verify against G.skills.revive.range in-game and tune if needed
	load_code(1); // Utils saved in slot 1
	load_code(2); // Movement saved in slot 2

setInterval(function(){
	loot();

	if(!attack_mode || character.rip) return;

	var mostHurt = null
	var target = null
	var nearestRip = null // Closest rip'd party member on our map — who to rush toward for revive
	var nearestRipDist = Infinity
	var Leader = get_player(LEADER_NAME) // Re-fetched every tick so we notice when the leader goes out of sight

	// SELF POT - above the moving check so we keep potting while traveling
	checkAndUseThreshold(character.mp,character.max_mp,300,"use_mp")
	checkAndUseThreshold(character.mp,character.max_mp,100,"regen_mp")
	checkAndUseThreshold(character.hp,character.max_hp,200,"use_hp")
	checkAndUseThreshold(character.hp,character.max_hp,50,"regen_hp")

		// Healing logic
	for (var name in get_party()) {
		var member = get_player(name)
		if (member && member.rip)
		{
			canCastSkill(member, "revive", G.skills.revive.mp, character.mp)
			if (member.map === character.map) {
				var ripDist = distance(character, member)
				if (ripDist < nearestRipDist) { nearestRipDist = ripDist; nearestRip = member }
			}
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

	// RUSH TO REVIVE - interrupts following/combat positioning to close distance on the nearest
	// rip'd party member, so revive (attempted above) can land as soon as possible.
	if (nearestRip)
	{
		moveToDistance(nearestRip, REVIVE_RANGE - 20)
		return;
	}

 	if(is_moving(character)) return;

	// Target player's target - Do not attack until Leader's target is damaged
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

	// Burst with curse only in a hard fight (a party member is hurt) and while MP is above reserve
	if (mostHurt && mostHurt.hp / mostHurt.max_hp < burstHealThreshold
		&& character.mp > character.max_mp * burstMpReserve)
		canCastSkill(target, "curse", G.skills.curse.mp, character.mp);

},1000/4); // Loops every 1/4 seconds.