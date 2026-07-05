    // shared/movement.js — custom smart_move replacement: A* pathfinding + cross-map routing.
    // Replaces the OOTB smart_move (its own source admits it "isn't very smart or efficient").
    // Data formats verified against game source (js/common_functions.js, js/runner_functions.js):
    //   G.geometry[map].x_lines = [x, y_start, y_end]  vertical walls, sorted by x
    //   G.geometry[map].y_lines = [y, x_start, x_end]  horizontal walls, sorted by y
    //   G.maps[map].doors[i]    = [x, y, w, h, dest_map, dest_spawn, own_spawn, ...]
    //                             door[8]=="complicated" means pathing can't use it
    //   G.npcs.transporter.places = {map: spawn_index}, usable within 75px of the npc
    //   can_move({map,x,y,going_x,going_y,base}) = exact straight-segment collision check

var movement = {
	CELL: 8,          // nav-grid cell size in px; smaller = tighter paths, bigger grids
	debug: false,     // draw the planned path in-game
	trace: false,     // log every routing decision (doors/Alia/town + why rejected)
	cmLog: false,     // log every party-position CM sent/received (toggle: smart_move.cm(true)) — off by default, floods the log
	tpLog: true,      // log town-teleport coordination CMs (start/cancel) separately from position spam (toggle: smart_move.tpLog(false))
	grids: {},        // map name -> built nav grid (session cache)
	// Alia (the "transporter" NPC) is an external/live entity on this server (id "$Alia",
	// npc "transporter"), NOT a static G.maps npc — so her position only exists while she's
	// rendered. These are her known standing spots per map, used to walk toward her when she's
	// off-screen at arrival; overwritten with her exact live position whenever we can see her.
	aliaPos: { main: [-83, -441], winterland: [-73, -393], desertland: [-14, -477] },
	// Maps where a live sighting has CONFIRMED aliaPos is actually reachable. Unconfirmed seeds
	// (typed above by hand) can be flat wrong — sitting inside wall geometry the A* grid can
	// never connect to (gridPath fails with "no path for leg" before we ever get close enough to
	// render her and self-correct). For any unconfirmed map, route to the map's spawn instead —
	// guaranteed walkable — and let the live re-check in walkTick snap onto her real position
	// once she renders (she's normally stationed near spawn), rather than trusting the seed.
	aliaConfirmed: {},
	// Live cross-map positions of party members, kept fresh by CM broadcast (send_cm/on_cm).
	// name -> {map,x,y,t}. get_party() only refreshes slowly, so after an Alia portal this is
	// the only timely source of the followed player's new map. followTick prefers it when fresh.
	partyPos: {},
	native: null,     // OOTB smart_move, kept for A/B comparison
	active: function () { return nav.moving && nav.legIndex < nav.legs.length; },
	following: function () { return nav.mode == "follow"; },
	state: function () { return { mode: nav.mode, moving: nav.moving, leg: nav.legIndex + "/" + nav.legs.length, dest: nav.dest }; },
};

var nav = {
	moving: false,
	mode: "idle",     // idle | route | follow
	dest: null,       // final {map,x,y}
	legs: [],         // [{type:"walk"|"transport"|"town", ...}]
	legIndex: 0,
	follow: null,     // name of followed player
	followPos: null,  // last known {map,x,y} of followed player
	lastRouteAt: 0,
	lastGuessAt: 0,   // last time we guessed the followed player took a door
	lastPos: null,
	stuckTicks: 0,
	repaths: 0,
	reroutes: 0,
	failedEdges: {},  // edge key -> Date.now() it failed; skipped on reroute until it expires (edgeFailed)
	resolve: null,
	reject: null,
	on_done: null,
};

    // Log to the in-game panel (where we watch) AND the devtools console. Diagnostics use this
    // so their output is visible without opening devtools; long JSON lines wrap in the panel.
function navLog(s) {
	if (typeof game_log === "function") game_log(s, "#8CE1FF");
	if (typeof console !== "undefined" && console.log) console.log(s);
}

    // ---------- nav grid: walkability grid per map, built lazily from wall lines ----------

    // Builds (or returns cached) grid for a map. Cells hold 1=walkable, 0=blocked.
    // Walls are inflated by the character's collision box so cell centers are safe standing spots.
function getGrid(map) {
	if (movement.grids[map]) return movement.grids[map];
	var geo = G.geometry[map];
	if (!geo) { navLog("nav: getGrid(" + map + ") — no G.geometry[" + map + "] entry, cannot build grid"); return null; }
	var xs = geo.x_lines || [], ys = geo.y_lines || [];
	if (!xs.length && !ys.length) { navLog("nav: getGrid(" + map + ") — geometry has no x_lines/y_lines"); return null; }
	var t0 = performance.now();
	var minX = geo.min_x, maxX = geo.max_x, minY = geo.min_y, maxY = geo.max_y;
	if (minX === undefined) { // some geometries lack bounds; derive them from the lines
		minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
		xs.forEach(function (l) { minX = Math.min(minX, l[0]); maxX = Math.max(maxX, l[0]); minY = Math.min(minY, l[1]); maxY = Math.max(maxY, l[2]); });
		ys.forEach(function (l) { minY = Math.min(minY, l[0]); maxY = Math.max(maxY, l[0]); minX = Math.min(minX, l[1]); maxX = Math.max(maxX, l[2]); });
	}
	var cs = movement.CELL;
	var cols = Math.ceil((maxX - minX) / cs) + 1;
	var rows = Math.ceil((maxY - minY) / cs) + 1;
	var cells = new Uint8Array(cols * rows).fill(1);
	// collision box: can_move checks corners at x±h, y+vn (bottom) and y−v (top)
	var base = character.base || { h: 8, v: 7, vn: 2 };
	function block(rx0, ry0, rx1, ry1) {
		var c0 = Math.max(0, Math.floor((rx0 - minX) / cs)), c1 = Math.min(cols - 1, Math.floor((rx1 - minX) / cs));
		var r0 = Math.max(0, Math.floor((ry0 - minY) / cs)), r1 = Math.min(rows - 1, Math.floor((ry1 - minY) / cs));
		for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) {
			var cx = minX + (c + 0.5) * cs, cy = minY + (r + 0.5) * cs;
			if (cx >= rx0 && cx <= rx1 && cy >= ry0 && cy <= ry1) cells[r * cols + c] = 0;
		}
	}
	xs.forEach(function (l) { block(l[0] - base.h, l[1] - base.vn, l[0] + base.h, l[2] + base.v); });
	ys.forEach(function (l) { block(l[1] - base.h, l[0] - base.vn, l[2] + base.h, l[0] + base.v); });
	var grid = { cols: cols, rows: rows, cells: cells, minX: minX, minY: minY, cs: cs };
	movement.grids[map] = grid;
	console.log("nav: built " + cols + "x" + rows + " grid for " + map + " in " + Math.round(performance.now() - t0) + "ms");
	return grid;
}

    // Nearest walkable cell index to a world point, spiraling outward. -1 if none nearby.
    // When reachFrom {x,y}+map is given, require a clear straight segment to the cell so we
    // don't snap the start across a wall (which makes A* begin on the wrong side).
    // maxR bounds the spiral (cells); widen it for targets that sit in tight/decorated spots
    // like NPCs (Alia's center is often unwalkable — we just need a standable cell near her).
function snapToWalkable(grid, x, y, map, reachFrom, maxR) {
	var c = Math.floor((x - grid.minX) / grid.cs), r = Math.floor((y - grid.minY) / grid.cs);
	for (var radius = 0; radius <= (maxR || 8); radius++) {
		for (var dr = -radius; dr <= radius; dr++) for (var dc = -radius; dc <= radius; dc++) {
			if (Math.max(Math.abs(dr), Math.abs(dc)) != radius) continue; // ring only
			var rr = r + dr, cc = c + dc;
			if (rr < 0 || cc < 0 || rr >= grid.rows || cc >= grid.cols) continue;
			if (!grid.cells[rr * grid.cols + cc]) continue;
			if (reachFrom) {
				var cx = grid.minX + (cc + 0.5) * grid.cs, cy = grid.minY + (rr + 0.5) * grid.cs;
				if (!canWalkSeg(map, reachFrom, { x: cx, y: cy })) continue;
			}
			return rr * grid.cols + cc;
		}
	}
	return -1;
}

    // ---------- A* over the grid, then smoothing with exact can_move checks ----------

    // A* with octile heuristic; diagonals allowed only when both orthogonal neighbors are open.
    // Returns world-coordinate waypoints from (fx,fy) to (tx,ty), or null if no path.
function gridPath(map, fx, fy, tx, ty) {
	var grid = getGrid(map);
	if (!grid) return null;
	var start = snapToWalkable(grid, fx, fy, map, { x: fx, y: fy });
	if (start < 0) start = snapToWalkable(grid, fx, fy); // wedged with no clear cell — take nearest anyway
	var goal = snapToWalkable(grid, tx, ty, null, null, 24); // search wide: NPC/target centers can be unwalkable
	if (start < 0 || goal < 0) {
		navLog("nav: gridPath(" + map + ") — snapToWalkable failed: start=" + Math.round(fx) + "," + Math.round(fy)
			+ " -> " + start + " | goal=" + Math.round(tx) + "," + Math.round(ty) + " -> " + goal
			+ " | grid " + grid.cols + "x" + grid.rows + " bounds [" + Math.round(grid.minX) + "," + Math.round(grid.minY)
			+ "]..[" + Math.round(grid.minX + grid.cols * grid.cs) + "," + Math.round(grid.minY + grid.rows * grid.cs) + "]");
		return null;
	}
	var cols = grid.cols, rows = grid.rows, cells = grid.cells, n = cols * rows;
	var gScore = new Float32Array(n).fill(Infinity);
	var fScore = new Float32Array(n);
	var parent = new Int32Array(n).fill(-1);
	var state = new Uint8Array(n); // 0 unseen, 1 open, 2 closed
	var heap = new Int32Array(n + 1), heapSize = 0;
	var goalR = (goal / cols) | 0, goalC = goal % cols;
	var SQRT2 = Math.SQRT2;
	function heuristic(idx) {
		var dr = Math.abs(((idx / cols) | 0) - goalR), dc = Math.abs((idx % cols) - goalC);
		return (dr + dc) + (SQRT2 - 2) * Math.min(dr, dc);
	}
	function heapPush(idx) {
		var i = ++heapSize; heap[i] = idx;
		while (i > 1 && fScore[heap[i >> 1]] > fScore[heap[i]]) { var t = heap[i >> 1]; heap[i >> 1] = heap[i]; heap[i] = t; i >>= 1; }
	}
	function heapPop() {
		var top = heap[1]; heap[1] = heap[heapSize--];
		var i = 1;
		while (true) {
			var l = i * 2, r = l + 1, m = i;
			if (l <= heapSize && fScore[heap[l]] < fScore[heap[m]]) m = l;
			if (r <= heapSize && fScore[heap[r]] < fScore[heap[m]]) m = r;
			if (m == i) break;
			var t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
		}
		return top;
	}
	gScore[start] = 0; fScore[start] = heuristic(start); state[start] = 1; heapPush(start);
	var found = false;
	// Track the closed node with the smallest heuristic-to-goal seen so far. If the goal turns
	// out to be in a disconnected region (e.g. an NPC standing behind indoor wall geometry with
	// no walkable connection to the field), we still return a path to this closest-approach node
	// instead of nothing — matches OOTB behavior of walking as close as possible rather than
	// giving up outright.
	var bestNode = start, bestH = heuristic(start);
	while (heapSize) {
		var cur = heapPop();
		if (state[cur] == 2) continue;
		state[cur] = 2;
		var h = heuristic(cur);
		if (h < bestH) { bestH = h; bestNode = cur; }
		if (cur == goal) { found = true; break; }
		var cr = (cur / cols) | 0, cc = cur % cols;
		for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
			if (!dr && !dc) continue;
			var nr = cr + dr, nc = cc + dc;
			if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
			var ni = nr * cols + nc;
			if (!cells[ni] || state[ni] == 2) continue;
			if (dr && dc && (!cells[cr * cols + nc] || !cells[nr * cols + cc])) continue; // no corner cutting
			var ng = gScore[cur] + (dr && dc ? SQRT2 : 1);
			if (ng < gScore[ni]) {
				gScore[ni] = ng; fScore[ni] = ng + heuristic(ni); parent[ni] = cur;
				heapPush(ni); state[ni] = 1;
			}
		}
	}
	if (!found) {
		if (bestNode == start) return null; // never moved at all — genuinely stuck, not just disconnected
		navLog("nav: gridPath(" + map + ") — goal in disconnected region; walking to closest reachable point instead "
			+ "(start " + Math.round(fx) + "," + Math.round(fy) + " -> goal " + Math.round(tx) + "," + Math.round(ty) + ")");
		var pts = [];
		for (var idx = bestNode; idx != -1; idx = parent[idx])
			pts.push({ x: grid.minX + ((idx % cols) + 0.5) * grid.cs, y: grid.minY + (((idx / cols) | 0) + 0.5) * grid.cs });
		pts.push({ x: fx, y: fy });
		pts.reverse();
		return smoothPath(map, pts);
	}
	var pts = [{ x: tx, y: ty }];
	for (var idx = goal; idx != -1; idx = parent[idx])
		pts.push({ x: grid.minX + ((idx % cols) + 0.5) * grid.cs, y: grid.minY + (((idx / cols) | 0) + 0.5) * grid.cs });
	pts.push({ x: fx, y: fy });
	pts.reverse();
	return smoothPath(map, pts);
}

    // Exact straight-segment walkability, using the game's own collision check with our body box.
function canWalkSeg(map, a, b) {
	return can_move({ map: map, x: a.x, y: a.y, going_x: b.x, going_y: b.y, base: character.base });
}

    // Greedy string-pulling: from each point, jump to the farthest directly-walkable point ahead,
    // so we walk long straight segments instead of grid staircases.
function smoothPath(map, pts) {
	var out = [], i = 0;
	while (i < pts.length - 1) {
		var j = Math.min(pts.length - 1, i + 60); // lookahead cap keeps can_move calls bounded
		while (j > i + 1 && !canWalkSeg(map, pts[i], pts[j])) j--;
		out.push(pts[j]);
		i = j;
	}
	return out;
}

    // ---------- cross-map router: Dijkstra over doors, transporter, and town teleports ----------

    // Rough cost of a town teleport in walking-distance terms (channel time * speed + slack).
function townCost() { return character.speed * 5 + 300; }

    // Point to stand at to use a door: its own-map spawn if defined, else the door rect itself.
function doorPoint(map, door) {
	var spawn = door[6] !== undefined && G.maps[map].spawns[door[6]];
	return spawn ? { x: spawn[0], y: spawn[1] } : { x: door[0], y: door[1] };
}

    // World position [x,y] of Alia (the transporter NPC, id "transporter") on a map, or null.
    // Tolerates every data shape: the live entity (find_npc gives .x/.y) when we're on that
    // map, and the static G.maps[map].npcs list (position, or positions[] for multi-placement).
    // Alia's live entity if she's currently RENDERED, else null. We scan parent.entities (real,
    // on-screen entities) and match by npc=="transporter" — her entity id is "$Alia". We do NOT
    // use find_npc here: off-screen it returns a placeholder at ~[-50,-50] that would overwrite
    // our good seed and strand us. Returning null when she's not visible lets transporterPos fall
    // back to the correct seeded/cached spot and walk toward her until she renders.
function findAlia() {
	var ents = (typeof parent !== "undefined" && parent.entities) ? parent.entities : {};
	for (var id in ents) {
		var e = ents[id];
		if (e && e.npc == "transporter" && (e.real_x !== undefined || e.x !== undefined)) return e;
	}
	return null;
}

    // Position [x,y] to walk to for Alia on a map. Prefers her live position (and caches it so
    // the seed self-corrects), then the cached/seed spot for when she's off-screen, then any
    // static G.maps npc entry as a last resort.
function transporterPos(mapName) {
	if (mapName == character.map) {
		var live = findAlia();
		if (live) {
			var lx = live.real_x !== undefined ? live.real_x : live.x;
			var ly = live.real_y !== undefined ? live.real_y : live.y;
			movement.aliaPos[mapName] = [lx, ly];
			movement.aliaConfirmed[mapName] = true;
			return movement.aliaPos[mapName];
		}
	}
	if (movement.aliaPos[mapName]) return movement.aliaPos[mapName];
	var npcs = (G.maps[mapName] || {}).npcs || [];
	for (var i = 0; i < npcs.length; i++) {
		if (npcs[i].id != "transporter") continue;
		if (npcs[i].position) return npcs[i].position;
		if (npcs[i].positions && npcs[i].positions[0]) return npcs[i].positions[0];
	}
	return null;
}

movement.EDGE_FAIL_TTL = 45000; // how long a failed edge (e.g. "can't reach Alia") stays blacklisted

    // A failed edge is only skipped for a while — a permanent blacklist means one bad tick (e.g.
    // an arrival-tolerance bug, or Alia briefly not rendered) disables that route for the rest of
    // the session even after the underlying cause is fixed. Expiring it lets the router try again.
function edgeFailed(key) {
	var t = nav.failedEdges[key];
	return t && (Date.now() - t < movement.EDGE_FAIL_TTL);
}

    // Finds the cheapest leg sequence from one {map,x,y} to another.
    // Intra-map distances are straight-line estimates; each walk leg gets exact A* at execution
    // time, and edges that fail in practice go into nav.failedEdges (with a timestamp, so a
    // reroute avoids them for a while — see edgeFailed) rather than being blacklisted forever.
function findRoute(from, to) {
	var startKey = from.map + "|start", GOAL = "|goal";
	var dist = {}, prev = {}, nodes = {}, open = [];
	dist[startKey] = 0; nodes[startKey] = { map: from.map, x: from.x, y: from.y };
	open.push(startKey);
	function relax(key, node, d, via, fromKey) {
		if (dist[key] !== undefined && dist[key] <= d) return;
		dist[key] = d; nodes[key] = node; prev[key] = { from: fromKey, via: via };
		open.push(key);
	}
	var done = {};
	while (open.length) {
		var best = null, bi = -1;
		for (var i = 0; i < open.length; i++) if (!done[open[i]] && (best === null || dist[open[i]] < dist[best])) { best = open[i]; bi = i; }
		if (best === null) break;
		open.splice(bi, 1);
		if (done[best]) continue;
		done[best] = true;
		if (best == GOAL) break;
		var node = nodes[best], d = dist[best], map = G.maps[node.map];
		if (!map) continue;
		if (node.map == to.map)
			relax(GOAL, to, d + Math.hypot(node.x - to.x, node.y - to.y), { walk: true }, best);
		(map.doors || []).forEach(function (door) {
			if (door[8] == "complicated") return;
			if (to.map != "bank" && door[4] == "bank" && !map.mount) return; // same manual patch the OOTB bfs applies
			var destMap = G.maps[door[4]];
			if (!destMap || !destMap.spawns || !destMap.spawns[door[5] || 0]) return;
			var edgeKey = node.map + ">door>" + door[4] + ">" + (door[5] || 0);
			if (edgeFailed(edgeKey)) return;
			var stand = doorPoint(node.map, door), spawn = destMap.spawns[door[5] || 0];
			relax(door[4] + "|door|" + door[0] + "," + door[1], { map: door[4], x: spawn[0], y: spawn[1] },
				d + Math.hypot(node.x - stand.x, node.y - stand.y) + 30,
				{ walkTo: { map: node.map, x: stand.x, y: stand.y }, transport: { map: door[4], s: door[5] || 0 }, edgeKey: edgeKey }, best);
		});
		var places = G.npcs.transporter && G.npcs.transporter.places;
		var tpos = places ? transporterPos(node.map) : null;
		if (movement.trace && !places) game_log("nav: no G.npcs.transporter.places — Alia routing disabled", "#CF5B5B");
		if (movement.trace && places && !tpos) game_log("nav: no Alia on " + node.map + " (transporterPos null)", "#F5A9A9");
		if (tpos) {
			for (var place in places) {
				if (place == node.map || !G.maps[place]) continue;
				var s = places[place], spawn = G.maps[place].spawns[s];
				if (!spawn) { if (movement.trace) game_log("nav: Alia->" + place + " has no spawn#" + s, "#F5A9A9"); continue; }
				var edgeKey = node.map + ">tp>" + place;
				if (edgeFailed(edgeKey)) { if (movement.trace) game_log("nav: Alia->" + place + " marked failed (expires in " + Math.ceil((movement.EDGE_FAIL_TTL - (Date.now() - nav.failedEdges[edgeKey])) / 1000) + "s)", "#F5A9A9"); continue; }
				if (movement.trace) game_log("nav: Alia edge " + node.map + "->" + place, "#A9F5A9");
				// Walk to her seed only once it's been live-confirmed reachable on this map;
				// otherwise walk to the map's own spawn (always reachable) and let walkTick's
				// live re-check correct onto her real position once she renders near there.
				var srcSpawn = G.maps[node.map].spawns && G.maps[node.map].spawns[0];
				var walkTarget = (movement.aliaConfirmed[node.map] || !srcSpawn) ? tpos : srcSpawn;
				if (movement.trace) navLog("nav: Alia walkTarget on " + node.map + " = " + JSON.stringify(walkTarget)
					+ " (confirmed=" + !!movement.aliaConfirmed[node.map] + ", srcSpawn=" + JSON.stringify(srcSpawn) + ", tpos=" + JSON.stringify(tpos) + ")");
				relax(place + "|tp", { map: place, x: spawn[0], y: spawn[1] },
					d + Math.hypot(node.x - tpos[0], node.y - tpos[1]) + 30,
					{ walkTo: { map: node.map, x: walkTarget[0], y: walkTarget[1] }, transport: { map: place, s: s }, edgeKey: edgeKey }, best);
			}
		}
		if (map.spawns && map.spawns[0] && !edgeFailed(node.map + ">town"))
			relax(node.map + "|town", { map: node.map, x: map.spawns[0][0], y: map.spawns[0][1] },
				d + townCost(), { town: true, edgeKey: node.map + ">town" }, best);
	}
	if (dist[GOAL] === undefined) return null;
	var hops = [];
	for (var k = GOAL; prev[k]; k = prev[k].from) hops.push({ via: prev[k].via, node: nodes[k] });
	hops.reverse();
	var legs = [];
	hops.forEach(function (hop) {
		if (hop.via.walkTo) {
			var kind = (hop.via.edgeKey && hop.via.edgeKey.indexOf(">tp>") >= 0) ? "transporter" : "door";
			// Alia's recorded spot is sometimes embedded in wall geometry (seen on winterland/
			// desertland) — pathing/collision can never get within the default 10px of it. She's
			// usable within ~65px (matches transportTick's own reach), so let the walk leg finish
			// there instead of endlessly retrying to stand exactly on top of an unreachable point.
			legs.push({ type: "walk", map: hop.via.walkTo.map, x: hop.via.walkTo.x, y: hop.via.walkTo.y, edgeKey: hop.via.edgeKey, arrive: kind == "transporter" ? 65 : undefined, kind: kind });
			legs.push({ type: "transport", map: hop.via.transport.map, s: hop.via.transport.s, kind: kind,
				stand: { map: hop.via.walkTo.map, x: hop.via.walkTo.x, y: hop.via.walkTo.y }, edgeKey: hop.via.edgeKey });
		} else if (hop.via.town) {
			legs.push({ type: "town", map: hop.node.map, x: hop.node.x, y: hop.node.y, edgeKey: hop.via.edgeKey });
		} else if (hop.via.walk) {
			legs.push({ type: "walk", map: hop.node.map, x: hop.node.x, y: hop.node.y });
		}
	});
	return { legs: legs, cost: dist[GOAL] };
}

    // ---------- controller: executes legs on its own tick, independent of combat loops ----------

setInterval(function () { navTick(); }, 80);

    // ---------- party position sharing over code messages (send_cm / on_cm) ----------

    // Other party member names, or [] if get_party()/send_cm aren't available — shared by the
    // position broadcast and the town-teleport signal below.
function partyMates() {
	if (typeof send_cm !== "function" || typeof get_party !== "function") return [];
	var party = get_party() || {};
	var mates = [];
	for (var name in party) if (name != character.name) mates.push(name);
	return mates;
}

    // Broadcast our own live position to the rest of the party ~1/sec. Every character does this,
    // so followers get each other's map+coords the instant someone Alia-portals — no waiting on
    // the slow server party refresh. Payload is tiny (rounded ints under an "ml_pos" key).
setInterval(function () {
	var mates = partyMates();
	if (!mates.length) return;
	var cx = character.real_x !== undefined ? character.real_x : character.x;
	var cy = character.real_y !== undefined ? character.real_y : character.y;
	var payload = { ml_pos: { map: character.map, x: Math.round(cx), y: Math.round(cy) } };
	try {
		send_cm(mates, payload);
		if (movement.cmLog) game_log("cm> pos " + payload.ml_pos.map + " " + payload.ml_pos.x + "," + payload.ml_pos.y + " -> " + mates.join(","), "#7FB2FF");
	} catch (e) {}
}, 1000);

    // Town-teleport coordination: "start" is sent the instant we cast town (townTick), so anyone
    // following us can fire their own town cast in parallel instead of waiting to notice we jumped.
    // "cancel" is sent if our channel gets interrupted (e.g. we got hit) before it landed — a
    // follower whose own cast is still mid-channel self-interrupts to avoid teleporting alone
    // while we stayed behind. No "success" message: a follower who got "start" already cast their
    // own and lands on their own; nothing left to react to.
function sendTpSignal(kind) {
	var mates = partyMates();
	if (!mates.length) return;
	try {
		send_cm(mates, { tp: kind });
		if (movement.tpLog) game_log("cm> tp " + kind + " -> " + mates.join(","), "#FFD37F");
	} catch (e) {}
}

    // Watches our OWN town-teleport channel (independent of whether we're mid-leg or reacting to
    // someone else's "start") and reports how it ended. character.c.town going true->false with
    // the skill NOT on cooldown means it never actually fired — interrupted, not completed.
(function () {
	var wasChanneling = false;
	setInterval(function () {
		var channeling = !!(character.c && character.c.town);
		if (wasChanneling && !channeling && typeof is_on_cooldown === "function" && !is_on_cooldown("town"))
			sendTpSignal("cancel");
		wasChanneling = channeling;
	}, 250);
})();

    // Register a global on_cm handler, chaining any pre-existing one so unrelated code messages
    // still reach it. We consume our own "ml_pos"/"tp" packets; everything else passes through.
(function () {
	var prevOnCm = (typeof on_cm === "function") ? on_cm : null;
	on_cm = function (name, data) {
		if (data && data.ml_pos && data.ml_pos.map) {
			movement.partyPos[name] = { map: data.ml_pos.map, x: data.ml_pos.x, y: data.ml_pos.y, t: Date.now() };
			if (movement.cmLog) game_log("cm< pos " + name + " @ " + data.ml_pos.map + " " + data.ml_pos.x + "," + data.ml_pos.y, "#A9D0FF");
		}
		if (data && data.tp && name == nav.follow) {
			if (movement.tpLog) game_log("cm< tp " + data.tp + " from " + name, "#FFD37F");
			if (data.tp == "start") {
				if (!(character.c && character.c.town) && (typeof is_on_cooldown !== "function" || !is_on_cooldown("town")))
					use_skill("town");
			} else if (data.tp == "cancel") {
				if (character.c && character.c.town) move(character.x, character.y); // self-interrupt to stay in sync
			}
		}
		if (prevOnCm) prevOnCm(name, data);
	};
})();

function navTick() {
	if (!nav.moving) return;
	if (character.rip) { navDone(false, "dead"); return; }
	if (nav.mode == "follow") followTick();
	var leg = nav.legs[nav.legIndex];
	if (!leg) {
		if (nav.mode == "follow") return; // caught up; stay engaged, combat movement takes over
		navDone(true);
		return;
	}
	if (leg.type == "walk") walkTick(leg);
	else if (leg.type == "transport") transportTick(leg);
	else if (leg.type == "town") townTick(leg);
}

    // Walk leg: A*-path to the leg target on first tick, then follow waypoints with stuck recovery.
function walkTick(leg) {
	var cx = character.real_x !== undefined ? character.real_x : character.x;
	var cy = character.real_y !== undefined ? character.real_y : character.y;
	if (character.map != leg.map) { reroute("wrong map"); return; }
	// The walk target was planned from a static SEED coordinate for Alia (movement.aliaPos),
	// which can simply be wrong for a given map (seen on winterland/desertland — she's recorded
	// inside a wall, nowhere near her real spot). transporterPos() prefers her LIVE rendered
	// position when we're on her map; once she comes on-screen, snap the leg target onto that
	// real position and re-path, instead of blindly walking toward — and getting stuck near — a
	// bad seed the whole way. Harmless once corrected: live position is stable, so this settles
	// after the first correction instead of re-pathing every tick.
	if (leg.kind == "transporter") {
		var live = transporterPos(character.map);
		if (live && Math.hypot(live[0] - leg.x, live[1] - leg.y) > 20) {
			if (movement.trace) navLog("nav: Alia seed corrected on " + character.map + ": " + Math.round(leg.x) + "," + Math.round(leg.y) + " -> " + Math.round(live[0]) + "," + Math.round(live[1]));
			leg.x = live[0]; leg.y = live[1]; leg.pts = null;
		}
	}
	// Check the (possibly widened) arrival tolerance BEFORE pathing/walking — some targets
	// (Alia standing in wall geometry) can never be closed to within the default 10px, so
	// bail out the moment we're within leg.arrive rather than grinding into a wall forever.
	if (leg.arrive && Math.hypot(cx - leg.x, cy - leg.y) < leg.arrive) { legDone(); return; }
	if (!leg.pts) {
		var pts = gridPath(leg.map, cx, cy, leg.x, leg.y);
		if (!pts) {
			if (canWalkSeg(leg.map, { x: cx, y: cy }, leg)) pts = [{ x: leg.x, y: leg.y }];
			else {
				// Blacklist a truly unreachable DOOR so reroute avoids it — but NOT an Alia
				// (>tp>) approach: the teleport itself is valid, so retrying beats permanently
				// falling back to a long walk just because her exact spot was hard to path to.
				if (leg.edgeKey && leg.edgeKey.indexOf(">tp>") < 0) nav.failedEdges[leg.edgeKey] = Date.now();
				reroute("no path for leg"); return;
			}
		}
		leg.pts = pts; leg.wp = 0;
		nav.stuckTicks = 0;
		if (movement.debug) {
			clear_drawings();
			var last = { x: cx, y: cy };
			pts.forEach(function (p) { draw_line(last.x, last.y, p.x, p.y, 2, 0x2E9AFE); last = p; });
		}
	}
	var wp = leg.pts[leg.wp];
	if (!wp || (leg.wp == leg.pts.length - 1 && Math.hypot(cx - leg.x, cy - leg.y) < (leg.arrive || 10))) { legDone(); return; }
	if (Math.hypot(cx - wp.x, cy - wp.y) < 10) { leg.wp++; return; }
	// stuck detection: we should be covering ground every tick while walking
	if (nav.lastPos && Math.hypot(cx - nav.lastPos.x, cy - nav.lastPos.y) < 0.5) nav.stuckTicks++;
	else nav.stuckTicks = 0;
	nav.lastPos = { x: cx, y: cy };
	if (nav.stuckTicks > 15) {
		nav.stuckTicks = 0;
		nav.repaths++;
		if (nav.repaths > 4) { reroute("stuck"); return; }
		leg.pts = null; // re-path this leg from wherever we're wedged
		return;
	}
	if (!character.moving || character.going_x != wp.x || character.going_y != wp.y) move(wp.x, wp.y);
}

    // Transport leg: make sure we're actually within range of the door/Alia, THEN fire the
    // request and wait for the map change. Firing while out of range just gets "Can't reach"
    // from the server, so we close any remaining gap first (using Alia's LIVE position for
    // transporter legs, so a stale planned point can't strand us), and time out onto a reroute
    // if we genuinely can't reach the stand point.
function transportTick(leg) {
	if (character.map == leg.map) { legDone(); return; }
	if (parent.transporting) return;
	var cx = character.real_x !== undefined ? character.real_x : character.x;
	var cy = character.real_y !== undefined ? character.real_y : character.y;
	var stand = null, reach = 70;
	if (leg.kind == "transporter") {
		var p = transporterPos(character.map);
		if (p) { stand = { x: p[0], y: p[1] }; reach = 65; }
	}
	else if (leg.stand && leg.stand.map == character.map) stand = leg.stand;
	if (stand && Math.hypot(cx - stand.x, cy - stand.y) > reach) {
		if (!leg.approachSince) leg.approachSince = Date.now();
		else if (Date.now() - leg.approachSince > 6000) { if (leg.edgeKey) nav.failedEdges[leg.edgeKey] = Date.now(); reroute("can't reach transport point"); return; }
		if (!character.moving || character.going_x != stand.x || character.going_y != stand.y) move(stand.x, stand.y);
		return;
	}
	leg.approachSince = 0;
	var now = Date.now();
	if (!leg.requested || now - leg.requested > 3000) {
		leg.tries = (leg.tries || 0) + 1;
		if (leg.tries > 3) { if (leg.edgeKey) nav.failedEdges[leg.edgeKey] = Date.now(); reroute("transport failed"); return; }
		// First try is silent; a retry means the previous transport() was rejected (usually
		// "cant_reach" = wrong stand point), so surface where we thought the NPC was vs where we are.
		if (movement.trace || leg.tries > 1)
			navLog("nav: transport " + (leg.kind || "door") + " -> " + leg.map + " s" + leg.s + " try#" + leg.tries
				+ (leg.kind == "transporter" ? "; Alia@" + (stand ? Math.round(stand.x) + "," + Math.round(stand.y) : "?") + " me@" + Math.round(cx) + "," + Math.round(cy) : ""));
		transport(leg.map, leg.s);
		leg.requested = now;
	}
}

    // Town leg: channel the town teleport; recast if interrupted, give up on the edge if it won't take.
function townTick(leg) {
	var cx = character.real_x !== undefined ? character.real_x : character.x;
	var cy = character.real_y !== undefined ? character.real_y : character.y;
	if (character.map == leg.map && Math.hypot(cx - leg.x, cy - leg.y) < 50) { legDone(); return; }
	if (character.c && character.c.town) return; // channeling
	var now = Date.now();
	if (!leg.requested || now - leg.requested > 12000) {
		leg.tries = (leg.tries || 0) + 1;
		if (leg.tries > 2) { nav.failedEdges[leg.edgeKey] = Date.now(); reroute("town failed"); return; }
		use_skill("town");
		sendTpSignal("start");
		leg.requested = now;
	}
}

function legDone() {
	nav.legIndex++;
	nav.repaths = 0;
	nav.lastPos = null;
}

    // Recompute the whole route from wherever we are; fail out after too many attempts.
function reroute(why) {
	if (nav.mode == "follow") { nav.legs = []; nav.legIndex = 0; return; } // followTick re-routes; never give up on a live follow
	nav.reroutes++;
	if (nav.reroutes > 4) { navDone(false, "failed"); return; }
	game_log("nav: rerouting (" + why + ")", "#F7D358");
	var cx = character.real_x !== undefined ? character.real_x : character.x;
	var cy = character.real_y !== undefined ? character.real_y : character.y;
	var route = findRoute({ map: character.map, x: cx, y: cy }, nav.dest);
	if (!route) { navDone(false, "failed"); return; }
	nav.legs = route.legs; nav.legIndex = 0;
}

    // Nearest door on a map within range of a point (door[0],door[1] is the door's base).
function doorNearPoint(map, x, y, range) {
	var doors = G.maps[map].doors || [];
	for (var i = 0; i < doors.length; i++)
		if (Math.hypot(doors[i][0] - x, doors[i][1] - y) < range) return doors[i];
	return null;
}

    // Follow mode: track the target's live position and re-route when it drifts.
    // When the target isn't visible (out of range, or gone through a door), fall back to the CM
    // position broadcast (fresh, cross-map), then slow server party data, then door inference.
function followTick() {
	if (parent.transporting) return; // mid map-transition — leave nav untouched until it lands
	var target = get_player(nav.follow) || parent.entities[nav.follow];
	if (target && !target.rip) nav.followPos = { map: target.map, x: target.real_x !== undefined ? target.real_x : target.x, y: target.real_y !== undefined ? target.real_y : target.y };
	var goal = nav.followPos;
	var cx = character.real_x !== undefined ? character.real_x : character.x;
	var cy = character.real_y !== undefined ? character.real_y : character.y;
	if (!target) {
		// Prefer our CM broadcast (updated ~1/sec, so it knows the new map instantly after a
		// portal) over get_party(), which the server refreshes only every tens of seconds.
		var pinfo = (typeof get_party === "function" ? (get_party() || {}) : {})[nav.follow];
		var cm = movement.partyPos[nav.follow];
		if (cm && Date.now() - cm.t < 15000) pinfo = cm;
		if (pinfo && pinfo.map) {
			if (!goal) goal = nav.followPos = { map: pinfo.map, x: pinfo.x, y: pinfo.y };
			else if (pinfo.map != character.map && goal.map == character.map)
				goal = nav.followPos = { map: pinfo.map, x: pinfo.x, y: pinfo.y }; // party knows they left this map
		}
		// Party data is authoritative for which map they're on — only fall back to guessing a
		// door when we have no cross-map party info, so we don't chase a door they never took.
		var haveMapFromParty = pinfo && pinfo.map && pinfo.map != character.map;
		if (!haveMapFromParty && goal && goal.map == character.map && Math.hypot(cx - goal.x, cy - goal.y) < 25
			&& Date.now() - nav.lastGuessAt > 10000) {
			// standing at their last-known spot and they're not here — did they take a door?
			var door = doorNearPoint(character.map, goal.x, goal.y, 100);
			if (door && G.maps[door[4]] && G.maps[door[4]].spawns[door[5] || 0]) {
				nav.lastGuessAt = Date.now();
				var sp = G.maps[door[4]].spawns[door[5] || 0];
				goal = nav.followPos = { map: door[4], x: sp[0], y: sp[1] };
			} else if (pinfo && pinfo.map == character.map && Math.hypot(pinfo.x - goal.x, pinfo.y - goal.y) > 50) {
				goal = nav.followPos = { map: pinfo.map, x: pinfo.x, y: pinfo.y }; // stale trail; head to party position
			}
		}
	}
	if (!goal) return;
	if (target && goal.map == character.map && Math.hypot(cx - goal.x, cy - goal.y) < 100) {
		nav.legs = []; nav.legIndex = 0; // close enough — combat spacing takes over
		return;
	}
	var stale = !nav.dest || nav.dest.map != goal.map || Math.hypot(nav.dest.x - goal.x, nav.dest.y - goal.y) > 80;
	var noLegs = nav.legIndex >= nav.legs.length;
	// Don't rebuild the route (which resets legIndex and wipes leg.requested/leg.tries) while an
	// Alia/town leg is actually firing — that restart loop is why transports never completed.
	var curLeg = nav.legs[nav.legIndex];
	var midTransport = curLeg && (curLeg.type == "transport" || curLeg.type == "town") && curLeg.requested;
	if (midTransport && !noLegs) return;
	if ((stale || noLegs) && Date.now() - nav.lastRouteAt > 500) {
		nav.lastRouteAt = Date.now();
		var route = findRoute({ map: character.map, x: cx, y: cy }, goal);
		if (route) { nav.dest = goal; nav.legs = route.legs; nav.legIndex = 0; nav.reroutes = 0; }
	}
}

function navDone(done, reason) {
	var resolve = nav.resolve, reject = nav.reject, cb = nav.on_done;
	nav.moving = false; nav.mode = "idle"; nav.legs = []; nav.legIndex = 0;
	nav.dest = null; nav.follow = null; nav.followPos = null;
	nav.resolve = nav.reject = nav.on_done = null;
	nav.stuckTicks = nav.repaths = nav.reroutes = 0;
	if (movement.debug) clear_drawings();
	if (cb) cb(done, reason);
	if (done && resolve) resolve({ success: true });
	else if (!done && reject) reject({ reason: reason || "failed" });
}

    // ---------- destination resolution: same inputs the OOTB smart_move accepts ----------

    // Turns a destination (string/coords/object) into {map,x,y}, or {join:event} for joinable
    // events. For monster names, picks the cheapest-to-reach location instead of a random one.
function resolveDestination(destination, from) {
	if (is_string(destination)) destination = { to: destination };
	if ("x" in destination) return { map: destination.map || character.map, x: destination.x, y: destination.y };
	var to = destination.to || destination.map;
	if (to == "town" || to == "mainland") to = "main";
	if (to == "desert") to = "desertland"; // canonical map id is desertland; accept the short name
	if (G.events[to] && parent.S[to] && G.events[to].join) return { join: to };
	if (G.monsters[to]) {
		var candidates = [];
		for (var name in G.maps) {
			(G.maps[name].monsters || []).forEach(function (pack) {
				if (pack.type != to || G.maps[name].ignore || G.maps[name].instance) return;
				(pack.boundaries || (pack.boundary ? [[name].concat(pack.boundary)] : [])).forEach(function (b) {
					candidates.push({ map: b[0], x: (b[1] + b[3]) / 2, y: (b[2] + b[4]) / 2 });
				});
			});
		}
		var best = null;
		candidates.forEach(function (c) {
			var route = findRoute(from, c);
			if (route && (!best || route.cost < best.cost)) best = { dest: c, cost: route.cost };
		});
		return best && best.dest;
	}
	if (G.maps[to]) {
		if (G.maps[to].event) return parent.S[G.maps[to].event] ? { join: G.maps[to].event } : null;
		return { map: to, x: G.maps[to].spawns[0][0], y: G.maps[to].spawns[0][1] };
	}
	if (to == "upgrade" || to == "compound") return { map: "main", x: -204, y: -129 };
	if (to == "exchange") return { map: "main", x: -26, y: -432 };
	if (to == "potions" && character.map == "halloween") return { map: "halloween", x: 149, y: -182 };
	if (to == "potions" && in_arr(character.map, ["winterland", "winter_inn", "winter_cave"])) return { map: "winter_inn", x: -84, y: -173 };
	if (to == "potions") return { map: "main", x: 56, y: -122 };
	if (to == "scrolls") return { map: "main", x: -465, y: -71 };
	var npc = find_npc(to);
	if (npc) return { map: npc.map, x: npc.x, y: npc.y + 15 };
	return null;
}

    // ---------- public API ----------

    // Drop-in smart_move replacement. Same signatures: smartMove("crab"), smartMove({x,y}),
    // smartMove(x, y), smartMove({to:...}) / {map:...}. Returns a Promise, on_done also honored.
function smartMove(destination, on_done) {
	if (is_number(destination)) { destination = { x: destination, y: on_done }; on_done = null; }
	var cx = character.real_x !== undefined ? character.real_x : character.x;
	var cy = character.real_y !== undefined ? character.real_y : character.y;
	var from = { map: character.map, x: cx, y: cy };
	var dest = resolveDestination(destination, from);
	if (!dest) {
		game_log("smartMove: unrecognized location", "#CF5B5B");
		if (on_done) on_done(false, "invalid");
		return Promise.reject({ reason: "invalid" });
	}
	if (dest.join) {
		join(dest.join);
		if (on_done) on_done(true);
		return Promise.resolve({ success: true });
	}
	if (nav.moving) navDone(false, "interrupted");
	var route = findRoute(from, dest);
	if (!route) {
		game_log("smartMove: no route found", "#CF5B5B");
		if (on_done) on_done(false, "failed");
		return Promise.reject({ reason: "failed" });
	}
	nav.dest = dest; nav.legs = route.legs; nav.legIndex = 0;
	nav.mode = "route"; nav.moving = true; nav.on_done = on_done || null;
	var summary = route.legs.map(function (l) { return l.type + (l.map ? "->" + l.map : ""); }).join(" ");
	var usesAlia = route.legs.some(function (l) { return l.type == "transport"; });
	navLog("smartMove -> " + dest.map + " " + Math.round(dest.x) + "," + Math.round(dest.y) + ": "
		+ route.legs.length + " legs " + (usesAlia ? "[Alia]" : "[walk-only]") + " | " + summary);
	var promise = new Promise(function (resolve, reject) { nav.resolve = resolve; nav.reject = reject; });
	promise.catch(function () {}); // callers that ignore the promise shouldn't get unhandled-rejection noise
	return promise;
}

    // Continuously follows a player across maps; idles (hands control to combat movement)
    // once within ~100px on the same map. Idempotent — safe to call every loop tick.
function smartFollow(target) {
	var name = is_string(target) ? target : (target.name || target.id);
	if (nav.mode == "follow" && nav.follow == name) return; // already following them — idempotent
	// A deliberate manual route (smart_move) in progress takes priority over the combat loop's
	// ambient "follow when idle" call. The combat loop calls followPlayer() every ~250ms, so
	// without this guard it would immediately steal control from a manual route — followTick
	// tracks the FOLLOWED PLAYER's position as the goal (not the manual destination), and its
	// "caught up, close enough" check can even wipe nav.legs outright if that player happens to
	// still be visible nearby. That silently killed manual smart_move calls made while a
	// character was also running combat-loop follow logic.
	if (nav.mode == "route" && nav.moving) return;
	nav.follow = name; nav.mode = "follow"; nav.moving = true;
	if (!is_string(target)) nav.followPos = { map: target.map, x: target.x, y: target.y };
}

    // Stops any smart movement or follow in progress.
function smartStop(reason) {
	if (nav.moving) navDone(false, reason || "stopped");
}

    // Diagnostic: compute and log the route to a destination WITHOUT moving. Returns the legs.
    // Flags whether the plan uses Alia (a transport leg) — the quick check for "why did it walk
    // the whole way instead of teleporting?". Usage in-game: movement.plan("winterland").
function planRoute(destination) {
	var cx = character.real_x !== undefined ? character.real_x : character.x;
	var cy = character.real_y !== undefined ? character.real_y : character.y;
	var from = { map: character.map, x: cx, y: cy };
	var dest = resolveDestination(destination, from);
	if (!dest) { navLog("plan: unrecognized location"); return null; }
	if (dest.join) { navLog("plan: join event " + dest.join); return dest; }
	var route = findRoute(from, dest);
	if (!route) { navLog("plan: no route to " + dest.map + " " + Math.round(dest.x) + "," + Math.round(dest.y)); return null; }
	var summary = route.legs.map(function (l) { return l.type + (l.map ? "->" + l.map : ""); }).join("  ");
	var usesAlia = route.legs.some(function (l) { return l.type == "transport"; });
	navLog("plan: " + route.legs.length + " legs, cost " + Math.round(route.cost) + (usesAlia ? " [uses Alia]" : " [no transport]"));
	navLog("  " + summary);
	return route.legs;
}
movement.plan = planRoute;

    // Deep diagnostic for "why isn't it using Alia?". Dumps the exact transporter game-state the
    // router depends on — the .places table, where Alia's NPC actually lives and in what data
    // shape, what transporterPos() resolves to, then a traced plan. Run: movement.diagnose("winterland")
function diagnose(destination) {
	function log(s) { navLog("diag: " + s); }
	log("char on " + character.map + " at " + Math.round(character.real_x) + "," + Math.round(character.real_y));
	log("aliaPos seeds: " + JSON.stringify(movement.aliaPos) + " | confirmed (live-sighted): " + JSON.stringify(movement.aliaConfirmed));
	var failedKeys = Object.keys(nav.failedEdges);
	if (failedKeys.length) {
		log("blacklisted edges (expire after " + (movement.EDGE_FAIL_TTL / 1000) + "s; smart_move.clearFailed() to reset now):");
		failedKeys.forEach(function (k) { log("  " + k + " — " + Math.round((Date.now() - nav.failedEdges[k]) / 1000) + "s ago" + (edgeFailed(k) ? "" : " (expired)")); });
	} else log("blacklisted edges: none");
	var T = G.npcs.transporter;
	log("G.npcs.transporter: " + (T ? "present" : "MISSING (Alia routing impossible)"));
	if (T) log("  .places = " + JSON.stringify(T.places));
	// Which maps actually place a transporter NPC, and in what field shape?
	var found = [];
	for (var mm in G.maps) if ((G.maps[mm].npcs || []).some(function (n) { return n.id == "transporter"; })) found.push(mm);
	log("maps whose G.maps[m].npcs contains id 'transporter': " + JSON.stringify(found));
	found.concat(found.length ? [] : ["main"]).forEach(function (m) {
		var entries = (G.maps[m] || {}).npcs || [];
		var tp = entries.filter(function (n) { return n.id == "transporter"; })
			.map(function (n) { return { keys: Object.keys(n), position: n.position, positions: n.positions }; });
		log(m + " transporter entry shape: " + JSON.stringify(tp));
		log("  transporterPos(" + m + ") = " + JSON.stringify(transporterPos(m)));
	});
	var live = (typeof find_npc === "function") ? find_npc("transporter") : null;
	log("find_npc('transporter') on current map: " + (live ? ("x=" + live.x + " y=" + live.y + " map=" + live.map) : "null (not on this map)"));
	if (T && T.places) for (var place in T.places) {
		var s = T.places[place], sp = (G.maps[place] || {}).spawns;
		log("  dest " + place + " spawn#" + s + " -> " + (sp && sp[s] ? JSON.stringify(sp[s]) : "MISSING map or spawn"));
	}
	if (destination !== undefined) {
		var wasTrace = movement.trace; movement.trace = true;
		log("--- traced plan to " + JSON.stringify(destination) + " ---");
		planRoute(destination);
		movement.trace = wasTrace;
	}
}
movement.diagnose = diagnose;

    // Shadow the OOTB smart_move so every existing call site gets the new behavior.
    // The original stays reachable at movement.native for side-by-side comparison.
movement.native = smart_move;
smart_move = smartMove;

    // The in-game "execute code" box can reach pre-existing globals like smart_move but NOT new
    // window properties, so `movement`/`mplan` throw "not defined" there. Hang the debug handles
    // off smart_move (which IS reachable): smart_move.plan("main"), smart_move.diagnose("main"),
    // smart_move.trace(true), smart_move.movement.aliaPos, etc.
smart_move.movement = movement;
smart_move.plan = planRoute;
smart_move.diagnose = diagnose;
smart_move.trace = function (on) { movement.trace = (on !== false); return "movement.trace = " + movement.trace; };
smart_move.cm = function (on) { movement.cmLog = (on !== false); return "movement.cmLog = " + movement.cmLog; };
smart_move.tpLog = function (on) { movement.tpLog = (on !== false); return "movement.tpLog = " + movement.tpLog; };
smart_move.follow = smartFollow; // manual follow: smart_move.follow("massive")
smart_move.stop = smartStop;     // cancel a follow/route: smart_move.stop()
smart_move.failedEdges = function () { return nav.failedEdges; }; // inspect the blacklist: smart_move.failedEdges()
smart_move.clearFailed = function () { var n = Object.keys(nav.failedEdges).length; nav.failedEdges = {}; return "cleared " + n + " failed edge(s)"; };

    // `movement` is a `var`, so it's local to this script's scope — reachable from our own
    // functions but NOT from the eval console (where `movement.debug = true` throws
    // "movement is not defined"). Publish it as a global on both this frame and the parent
    // (character code runs in a child frame; the console may eval in either) so debug flags
    // and movement.plan/diagnose are usable interactively.
    // Publish `movement` and standalone debug helpers onto every frame the in-game "execute
    // code" box might eval in (this frame, its parent, the top). Bare `mdiag(...)` etc. don't
    // depend on the caller being able to see the `movement` var, which is the failure we hit.
(function () {
	var targets = [];
	try { if (typeof window !== "undefined") targets.push(window); } catch (e) {}
	try { if (typeof parent !== "undefined" && targets.indexOf(parent) < 0) targets.push(parent); } catch (e) {}
	try { if (typeof top !== "undefined" && targets.indexOf(top) < 0) targets.push(top); } catch (e) {}
	targets.forEach(function (w) {
		try {
			w.movement = movement;
			w.mplan = planRoute;
			w.mdiag = diagnose;
			w.mtrace = function (on) { movement.trace = (on !== false); return "movement.trace = " + movement.trace; };
			w.mdebug = function (on) { movement.debug = (on !== false); return "movement.debug = " + movement.debug; };
			w.mcm = function (on) { movement.cmLog = (on !== false); return "movement.cmLog = " + movement.cmLog; };
			w.mtplog = function (on) { movement.tpLog = (on !== false); return "movement.tpLog = " + movement.tpLog; };
			w.mfollow = smartFollow; // bare-global manual follow: mfollow("massive")
			w.mstop = smartStop;
			w.mfailed = function () { return nav.failedEdges; };
			w.mclear = function () { var n = Object.keys(nav.failedEdges).length; nav.failedEdges = {}; return "cleared " + n + " failed edge(s)"; };
		} catch (e) {}
	});
})();

    // Load stamp: prints in-game on load_code so you can confirm THIS version is the one running.
    // If you don't see this line after load_code(2), the slot has a stale/partial paste.
if (typeof game_log === "function") game_log("movement.js loaded v20 — cmLog (position spam) now off by default; town-teleport start/cancel signals log separately under tpLog", "#8CE1FF");
