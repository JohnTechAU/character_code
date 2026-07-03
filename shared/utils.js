    // Determines if the current value is below the threshold and uses the skill if not on cooldown
function checkAndUseThreshold(currentValue, maxValue, thresholdBelowMax, skillName) {
	if (currentValue <= maxValue - thresholdBelowMax) {
		if (is_on_cooldown(skillName)) return false;
		use_skill(skillName);
	}
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

    // Follows a player while maintaining a distance equal to the character's range minus 20 units. If the player is on a different map, it will attempt to smart move to that map and position.
function followPlayer(followedPlayer) {

    if (!followedPlayer) {
        set_message("Player not found: " + followedPlayer);
        return;
    }

    if (followedPlayer.map !== character.map) {
        set_message("Player is on a different map: " + followedPlayer.map);
            if (!character.moving) {
                smart_move({ map: followedPlayer.map, x: followedPlayer.x, y: followedPlayer.y });
            }
            return;
        }

    var dist = distance(character, followedPlayer);
    var idealDist = character.range - 100;
    if (Math.abs(dist - idealDist) <= 20) {
        // I'm within 10 of my ideal distance — good enough, don't move
        return;
    }

    var dx = character.x - followedPlayer.x;
    var dy = character.y - followedPlayer.y;

    if (dist === 0) {
        move(followedPlayer.x + idealDist, followedPlayer.y);
        return;
    }

    move(
        followedPlayer.x + (dx / dist) * idealDist,
        followedPlayer.y + (dy / dist) * idealDist
    );
    }