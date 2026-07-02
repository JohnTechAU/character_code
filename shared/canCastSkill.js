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