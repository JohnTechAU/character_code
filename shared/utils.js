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

    // Follows a player — takes an entity or a name (name works even when they're out of sight,
    // e.g. just went through a door; smartFollow then tracks via party data + door inference).
    // Visible and close: combat spacing via moveToRange.
function followPlayer(followedPlayer) {

    if (!followedPlayer) {
        set_message("Player not found: " + followedPlayer);
        return;
    }
    var entity = is_string(followedPlayer) ? get_player(followedPlayer) : followedPlayer;

    if (typeof movement === "undefined") {
        // movement.js (CODE slot 2) isn't loaded — load_code fails silently on an empty slot.
        // Warn once and fall back to the OOTB follow behavior so the character still functions.
        if (!followPlayer.warned) {
            followPlayer.warned = true;
            game_log("movement.js not loaded — is it saved in the CODE slot load_code() points at? Using OOTB smart_move", "#CF5B5B");
        }
        if (!entity) return;
        if (entity.map !== character.map) {
            if (!character.moving) smart_move({ map: entity.map, x: entity.x, y: entity.y });
            return;
        }
        moveToRange(entity);
        return;
    }

    if (!entity || entity.map !== character.map) {
        set_message("Following " + (is_string(followedPlayer) ? followedPlayer : entity.name));
        smartFollow(entity || followedPlayer);
        return;
    }
    if (distance(character, entity) > 200 && !can_move_to(entity.x, entity.y)) {
        smartFollow(entity); // same map but no straight line — needs real pathing
        return;
    }
    if (movement.following()) smartStop("caught up");
    moveToRange(entity);

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


