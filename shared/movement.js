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
	trace: false,     // log every routing decision (doors/Alia/town considered + why rejected)
	grids: {},        // map name -> built nav grid (session cache)
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
	failedEdges: {},  // edge keys that failed in practice; skipped on reroute
	resolve: null,
	reject: null,
	on_done: null,
};

    // ---------- nav grid: walkability grid per map, built lazily from wall lines ----------

    // Builds (or returns cached) grid for a map. Cells hold 1=walkable, 0=blocked.
    // Walls are inflated by the character's collision box so cell centers are safe standing spots.
function getGrid(map) {
	if (movement.grids[map]) return movement.grids[map];
	var geo = G.geometry[map];
	if (!geo) return null;
	var xs = geo.x_lines || [], ys = geo.y_lines || [];
	if (!xs.length && !ys.length) return null;
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
function snapToWalkable(grid, x, y, map, reachFrom) {
	var c = Math.floor((x - grid.minX) / grid.cs), r = Math.floor((y - grid.minY) / grid.cs);
	for (var radius = 0; radius <= 8; radius++) {
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
	var goal = snapToWalkable(grid, tx, ty);
	if (start < 0 || goal < 0) return null;
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
	while (heapSize) {
		var cur = heapPop();
		if (state[cur] == 2) continue;
		state[cur] = 2;
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
	if (!found) return null;
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
function transporterPos(mapName) {
	if (mapName == character.map) {
		var live = find_npc("transporter");
		if (live && live.x !== undefined) return [live.x, live.y];
	}
	var npcs = (G.maps[mapName] || {}).npcs || [];
	for (var i = 0; i < npcs.length; i++) {
		if (npcs[i].id != "transporter") continue;
		if (npcs[i].position) return npcs[i].position;
		if (npcs[i].positions && npcs[i].positions[0]) return npcs[i].positions[0];
	}
	return null;
}

    // Finds the cheapest leg sequence from one {map,x,y} to another.
    // Intra-map distances are straight-line estimates; each walk leg gets exact A* at execution
    // time, and edges that fail in practice go into nav.failedEdges so a reroute avoids them.
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
			if (nav.failedEdges[edgeKey]) return;
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
				if (nav.failedEdges[edgeKey]) { if (movement.trace) game_log("nav: Alia->" + place + " marked failed", "#F5A9A9"); continue; }
				if (movement.trace) game_log("nav: Alia edge " + node.map + "->" + place, "#A9F5A9");
				relax(place + "|tp", { map: place, x: spawn[0], y: spawn[1] },
					d + Math.hypot(node.x - tpos[0], node.y - tpos[1]) + 30,
					{ walkTo: { map: node.map, x: tpos[0], y: tpos[1] }, transport: { map: place, s: s }, edgeKey: edgeKey }, best);
			}
		}
		if (map.spawns && map.spawns[0] && !nav.failedEdges[node.map + ">town"])
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
			legs.push({ type: "walk", map: hop.via.walkTo.map, x: hop.via.walkTo.x, y: hop.via.walkTo.y, edgeKey: hop.via.edgeKey });
			legs.push({ type: "transport", map: hop.via.transport.map, s: hop.via.transport.s, edgeKey: hop.via.edgeKey });
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
	if (!leg.pts) {
		var pts = gridPath(leg.map, cx, cy, leg.x, leg.y);
		if (!pts) {
			if (canWalkSeg(leg.map, { x: cx, y: cy }, leg)) pts = [{ x: leg.x, y: leg.y }];
			else { if (leg.edgeKey) nav.failedEdges[leg.edgeKey] = true; reroute("no path for leg"); return; }
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
	if (!wp || (leg.wp == leg.pts.length - 1 && Math.hypot(cx - leg.x, cy - leg.y) < 10)) { legDone(); return; }
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

    // Transport leg: fire the door/transporter request and wait for the map change.
function transportTick(leg) {
	if (character.map == leg.map) { legDone(); return; }
	if (parent.transporting) return;
	var now = Date.now();
	if (!leg.requested || now - leg.requested > 3000) {
		leg.tries = (leg.tries || 0) + 1;
		if (leg.tries > 3) { if (leg.edgeKey) nav.failedEdges[leg.edgeKey] = true; reroute("transport failed"); return; }
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
		if (leg.tries > 2) { nav.failedEdges[leg.edgeKey] = true; reroute("town failed"); return; }
		use_skill("town");
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
    // When the target isn't visible (out of range, or gone through a door), fall back to
    // party data (server updates it ~every 60s) and door inference at their last-known spot.
function followTick() {
	var target = get_player(nav.follow) || parent.entities[nav.follow];
	if (target && !target.rip) nav.followPos = { map: target.map, x: target.real_x !== undefined ? target.real_x : target.x, y: target.real_y !== undefined ? target.real_y : target.y };
	var goal = nav.followPos;
	var cx = character.real_x !== undefined ? character.real_x : character.x;
	var cy = character.real_y !== undefined ? character.real_y : character.y;
	if (!target) {
		var pinfo = (typeof get_party === "function" ? (get_party() || {}) : {})[nav.follow];
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
	console.log("smartMove: " + dest.map + " " + Math.round(dest.x) + "," + Math.round(dest.y) + " (" + route.legs.length + " legs)");
	var promise = new Promise(function (resolve, reject) { nav.resolve = resolve; nav.reject = reject; });
	promise.catch(function () {}); // callers that ignore the promise shouldn't get unhandled-rejection noise
	return promise;
}

    // Continuously follows a player across maps; idles (hands control to combat movement)
    // once within ~100px on the same map. Idempotent — safe to call every loop tick.
function smartFollow(target) {
	var name = is_string(target) ? target : (target.name || target.id);
	if (nav.mode == "follow" && nav.follow == name) return;
	if (nav.moving) navDone(false, "interrupted");
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
	if (!dest) { console.log("movement.plan: unrecognized location"); return null; }
	if (dest.join) { console.log("movement.plan: join event " + dest.join); return dest; }
	var route = findRoute(from, dest);
	if (!route) { console.log("movement.plan: no route to " + dest.map + " " + Math.round(dest.x) + "," + Math.round(dest.y)); return null; }
	var summary = route.legs.map(function (l) { return l.type + (l.map ? "->" + l.map : ""); }).join("  ");
	var usesAlia = route.legs.some(function (l) { return l.type == "transport"; });
	console.log("movement.plan: " + route.legs.length + " legs, cost " + Math.round(route.cost)
		+ (usesAlia ? " [uses Alia]" : " [no transport]") + "\n  " + summary);
	return route.legs;
}
movement.plan = planRoute;

    // Deep diagnostic for "why isn't it using Alia?". Dumps the exact transporter game-state the
    // router depends on — the .places table, where Alia's NPC actually lives and in what data
    // shape, what transporterPos() resolves to, then a traced plan. Run: movement.diagnose("winterland")
function diagnose(destination) {
	function log(s) { console.log("diag: " + s); }
	log("char on " + character.map + " at " + Math.round(character.real_x) + "," + Math.round(character.real_y));
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

    // `movement` is a `var`, so it's local to this script's scope — reachable from our own
    // functions but NOT from the eval console (where `movement.debug = true` throws
    // "movement is not defined"). Publish it as a global on both this frame and the parent
    // (character code runs in a child frame; the console may eval in either) so debug flags
    // and movement.plan/diagnose are usable interactively.
try { window.movement = movement; } catch (e) {}
try { if (typeof parent !== "undefined" && parent !== window) parent.movement = movement; } catch (e) {}
