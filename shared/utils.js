    // Determines if the current value is below the threshold and uses the skill if not on cooldown
function checkAndUseThreshold(currentValue, maxValue, thresholdBelowMax, skillName) {
	if (currentValue <= maxValue - thresholdBelowMax) {
		if (is_on_cooldown(skillName)) return false;
		use_skill(skillName);
	}
}

    // Estimates hits-to-kill (targetMaxHp / myAttack) and returns true if it exceeds hitThreshold,
    // i.e. the target is tanky enough that spending a skill to burst it down is worthwhile.
function isSkillWorthwhile(targetMaxHp, myAttack, hitThreshold) {
    var hits = targetMaxHp / myAttack;
    return hits > hitThreshold;
}

    // Determines if a skill can be cast based on the current value and threshold
function canCastSkill(target, skillName, mpCost, characterMp) {
    if (!is_in_range(target, skillName)) {
        //game_log(target + " is out of range for " + skillName);
        return false;
    }
        //game_log("SUCCESS - " + target + " is of range for " + skillName);
    if (is_on_cooldown(skillName)) {
        //game_log(skillName + " is on cooldown");
        return false;
    }
        //game_log("SUCCESS - " + skillName + "is NOT on cooldown");
    if (mpCost <= characterMp) {
        use_skill(skillName, target);
        //game_log("SUCCESS - " + skillName + " casted");
        return true;
    }
    else {
        //game_log("Not enough MP to cast " + skillName);
        return false;
    }
}

    // Follows a player. Different map, or same map but far/blocked: hand off to smartFollow
    // (movement.js), which tracks them across doors. Close by: combat spacing via moveToRange.
function followPlayer(followedPlayer) {

    if (!followedPlayer) {
        set_message("Player not found: " + followedPlayer);
        return;
    }

    if (followedPlayer.map !== character.map) {
        set_message("Following to " + followedPlayer.map);
        smartFollow(followedPlayer);
        return;
    }
    if (distance(character, followedPlayer) > 200 && !can_move_to(followedPlayer.x, followedPlayer.y)) {
        smartFollow(followedPlayer); // same map but no straight line — needs real pathing
        return;
    }
    if (movement.following()) smartStop("caught up");
    moveToRange(followedPlayer);

}

    // Moves the character to maintain a distance equal to the character's range minus 20 units from the target. If the character is already within 10 units of this ideal distance, it will not move.
function moveToRange(target) {
    {
        if (typeof movement !== "undefined" && movement.active()) return; // a smart route is driving; don't fight it
        var dist = distance(character, target);
        var idealDist = character.range - 20; // Maintain a distance of character's range minus 20 units
        if (Math.abs(dist - idealDist) <= 10) {
            // I'm within 10 of my ideal distance — good enough, don't move
            return;
        }

        var dx = character.x - target.x;
        var dy = character.y - target.y;

        if (dist === 0) {
            move(target.x + idealDist, target.y);
            return;
        }

        move(
            target.x + (dx / dist) * idealDist,
            target.y + (dy / dist) * idealDist
        );
    }
}


