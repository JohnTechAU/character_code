    // shared/zones.js — per-zone monster type list + monster-pack location lookup, plus
    // functions to turn that list into a farming order (efficient route or random).
    // Used by Warrior.js's FARM_MODE: cycle through the built order, farming each
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

    // Greedy nearest-neighbor route through zones[map]'s monster types, starting from `from`
    // ({x,y}, typically the character's position when farming kicks off). Each step picks
    // whichever remaining type has a spawn location closest to the current position, then
    // "moves" there before picking the next — so the resulting order walks a short path instead
    // of whatever order the type list happens to be written in.
    // Types with no known spawn locations (findZoneGroupLocations returns []) can't be routed by
    // distance, so they're appended at the end in their original relative order.
function buildEfficientOrder(map, from) {
	var routable = [];
	var unroutable = [];
	(zones[map] || []).forEach(function (type) {
		var locs = findZoneGroupLocations(map, type);
		if (locs.length) routable.push({ type: type, locs: locs });
		else unroutable.push(type);
	});

	var order = [];
	var current = from;
	while (routable.length) {
		var bestIdx = 0, bestLoc = null, bestDist = Infinity;
		routable.forEach(function (entry, i) {
			entry.locs.forEach(function (loc) {
				var d = distance(current, loc);
				if (d < bestDist) { bestDist = d; bestIdx = i; bestLoc = loc; }
			});
		});
		order.push(routable[bestIdx].type);
		current = bestLoc;
		routable.splice(bestIdx, 1);
	}
	return order.concat(unroutable);
}

    // Fisher-Yates shuffle of zones[map]'s monster types.
function buildRandomOrder(map) {
	var types = (zones[map] || []).slice();
	for (var i = types.length - 1; i > 0; i--) {
		var j = Math.floor(Math.random() * (i + 1));
		var tmp = types[i]; types[i] = types[j]; types[j] = tmp;
	}
	return types;
}
