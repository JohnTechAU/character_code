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
    followLeash(entity);

}

    // True unless the point sits within an aggressive, untanked monster's range — i.e. a monster
    // with aggro > 0 whose current target isn't the leader. Used to keep idle-follow movement
    // from walking hunter/priest into a fight the leader isn't already tanking.
function isDestinationSafe(x, y, leaderName) {
    for (let id in parent.entities) {
        let entity = parent.entities[id];
        if (entity.type !== "monster") continue;
        var mData = G.monsters[entity.mtype];
        if (!mData || !mData.aggro) continue;
        if (entity.target === leaderName) continue;
        if (distance({ x: x, y: y }, entity) < mData.range) return false;
    }
    return true;
}

    // Idle-follow: only moves once farther than character.range from the leader (a wide "close
    // enough" leash instead of moveToRange's exact-distance lock), and when it does move, it aims
    // for the leader position - 20 (same spot moveToRange would pick) but skips the move entirely
    // if that spot isn't safe from untanked aggressive monsters.
function followLeash(leader) {
    if (typeof movement !== "undefined" && movement.active()) return; // a smart route is driving; don't fight it
    var dist = distance(character, leader);
    if (dist <= character.range) return; // inside the leash — close enough, don't move

    var idealDist = character.range - 20;
    var dx = character.x - leader.x;
    var dy = character.y - leader.y;
    var destX = dist === 0 ? leader.x + idealDist : leader.x + (dx / dist) * idealDist;
    var destY = dist === 0 ? leader.y : leader.y + (dy / dist) * idealDist;

    if (!isDestinationSafe(destX, destY, leader.name)) return; // unsafe — stand still instead

    move(destX, destY);
}

    // Moves the character to sit at idealDist units from target. No-ops if already within
    // 10 units of that distance, or if a smart route (movement.js) is actively driving.
function moveToDistance(target, idealDist) {
    if (typeof movement !== "undefined" && movement.active()) return; // a smart route is driving; don't fight it
    var dist = distance(character, target);
    if (Math.abs(dist - idealDist) <= 10) {
        // Already within 10 of the ideal distance — good enough, don't move
        return;
    }

    var dx = character.x - target.x;
    var dy = character.y - target.y;

    var destX = dist === 0 ? target.x + idealDist : target.x + (dx / dist) * idealDist;
    var destY = dist === 0 ? target.y : target.y + (dy / dist) * idealDist;

    // moveToDistance's straight-line move has no wall-awareness — fine for a clear approach, but
    // a target that's Euclidean-close yet on the far side of wall geometry (e.g. bees split across
    // adjacent spawn regions) sends the character walking straight into that wall. Check the line
    // first (can_move_to, same built-in followPlayer already uses for this) and detour through
    // smart_move's pathfinding when it's blocked, instead of walking straight at the obstruction.
    if (!can_move_to(destX, destY)) {
        // movement.active() is already known false (guarded at the top of this function), so it's
        // safe to kick off a route here without fighting an in-progress one.
        if (typeof movement !== "undefined") { smart_move({ x: target.x, y: target.y }); return; }
        // movement.js not loaded — no pathfinding available, fall back to the straight-line move.
    }

    move(destX, destY);
}

    // Moves the character to maintain a distance equal to the character's range minus 20 units from the target (thin wrapper over moveToDistance).
function moveToRange(target) {
    moveToDistance(target, character.range - 20);
}


