// Determines if a skill can be cast based on the current value and threshold
function canCastSkill(target, skillName, mpCost, characterMp) {
    if (!is_in_range(target)) return false;
    if (is_on_cooldown(skillName)) return false;
	if (mpCost <= characterMp) {
		use_skill(skillName, target);
        return true;
	}
    else {
        return false;
    }
}