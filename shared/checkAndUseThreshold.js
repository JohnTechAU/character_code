// Checks if the current value is below the threshold and uses the skill if not on cooldown
function checkAndUseThreshold(currentValue, maxValue, thresholdBelowMax, skillName) {
	if (currentValue <= maxValue - thresholdBelowMax) {
		if (is_on_cooldown(skillName)) return;
		use_skill(skillName);
	}
}