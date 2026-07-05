    // shared/zones.js — hardcoded per-zone farming order + monster-pack location lookup.
    // Used by Warrior.js's FARM_MODE: cycle through zones[ZONE] in order, farming each
    // monster type until every visible one is down to level 1, then move to the next.

var zones = {
	// Best-guess mtype keys for the names Johnny gave — verify against G.maps.main.monsters
	// in-game (e.g. (G.maps.main.monsters||[]).map(p=>p.type)) before relying on this list,
	// since display names ("tiny crab", "armadilo") don't always match the mtype key exactly.
	main:        ["goo", "bee", "crab", "snake", "squig", "armadillo", "croc", "tortoise", "squigtoad"],
	winterland:  [],
	desertland:  [],
};

    // Returns ALL known spawn-region centers for a monster type on one map (not just the first).
    // A pack's `boundaries` can itself hold multiple separate rectangles for one type (e.g. bees
    // have several spawn regions on "main") — collect every one, from every matching pack entry,
    // mirroring the boundary-collection movement.js's resolveDestination does globally
    // (shared/movement.js ~line 663), but scoped to one map so farming stays inside the zone.
    // Returns [] (not null) when nothing matches — callers must check .length.
function findZoneGroupLocations(map, type) {
	var packs = (G.maps[map] || {}).monsters || [];
	var locs = [];
	packs.forEach(function (pack) {
		if (pack.type != type) return;
		var b = pack.boundaries || (pack.boundary ? [[map].concat(pack.boundary)] : []);
		b.forEach(function (rect) {
			locs.push({ map: map, x: (rect[1] + rect[3]) / 2, y: (rect[2] + rect[4]) / 2 });
		});
	});
	return locs;
}
