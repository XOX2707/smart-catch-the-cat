/*!
 * Smart cat AI for ganlvtech/phaser-catch-the-cat
 *
 * A solver is called as solver(blocksIsWall, i, j) where blocksIsWall[i][j]
 * is true for walls, (i, j) is the cat (column, row). It returns the
 * direction to step: 0 left, 1 top-left, 2 top-right, 3 right,
 * 4 bottom-right, 5 bottom-left, or -1 to give up.
 *
 * Works in the browser (window.CatAI) and in Node (module.exports).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.CatAI = factory();
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var INF = 1e9;

    // Same layout as MainScene.getNeighbours: odd rows are shifted right.
    function getNeighbours(i, j) {
        if ((j & 1) === 0) {
            return [
                {i: i - 1, j: j},
                {i: i - 1, j: j - 1},
                {i: i, j: j - 1},
                {i: i + 1, j: j},
                {i: i, j: j + 1},
                {i: i - 1, j: j + 1},
            ];
        }
        return [
            {i: i - 1, j: j},
            {i: i, j: j - 1},
            {i: i + 1, j: j - 1},
            {i: i + 1, j: j},
            {i: i + 1, j: j + 1},
            {i: i, j: j + 1},
        ];
    }

    // Flat board: cell index k = i * h + j. nb[k * 6 + d] is the neighbour
    // in direction d, or -1 when it is off the board.
    var geometryCache = {};

    function geometry(w, h) {
        var key = w + "x" + h;
        if (geometryCache[key]) {
            return geometryCache[key];
        }
        var n = w * h;
        var nb = new Int32Array(n * 6);
        var edge = new Uint8Array(n);
        for (var i = 0; i < w; i++) {
            for (var j = 0; j < h; j++) {
                var k = i * h + j;
                edge[k] = i <= 0 || i >= w - 1 || j <= 0 || j >= h - 1 ? 1 : 0;
                var ns = getNeighbours(i, j);
                for (var d = 0; d < 6; d++) {
                    var p = ns[d];
                    nb[k * 6 + d] = p.i >= 0 && p.i < w && p.j >= 0 && p.j < h ? p.i * h + p.j : -1;
                }
            }
        }
        geometryCache[key] = {w: w, h: h, n: n, nb: nb, edge: edge};
        return geometryCache[key];
    }

    function toFlat(blocksIsWall, g) {
        var wall = new Uint8Array(g.n);
        for (var i = 0; i < g.w; i++) {
            for (var j = 0; j < g.h; j++) {
                wall[i * g.h + j] = blocksIsWall[i][j] ? 1 : 0;
            }
        }
        return wall;
    }

    /**
     * Plain distance to the nearest free edge cell, ignoring the player.
     */
    function edgeDistance(g, wall, out) {
        var dist = out || new Int32Array(g.n);
        var queue = new Int32Array(g.n);
        var head = 0;
        var tail = 0;
        for (var k = 0; k < g.n; k++) {
            dist[k] = INF;
            if (g.edge[k] && !wall[k]) {
                dist[k] = 0;
                queue[tail++] = k;
            }
        }
        while (head < tail) {
            var c = queue[head++];
            for (var d = 0; d < 6; d++) {
                var m = g.nb[c * 6 + d];
                if (m >= 0 && !wall[m] && dist[m] === INF) {
                    dist[m] = dist[c] + 1;
                    queue[tail++] = m;
                }
            }
        }
        return dist;
    }

    /**
     * "k-distance": how many cat moves it takes to escape from a cell when
     * the player moves first and walls off k - 1 cells before every cat move.
     * The normal game is k = 2 ("two-distance").
     *
     * A free edge cell is 0 (when edgeOk is given, only the edge cells it
     * accepts count). Any other cell is 1 + the k-th smallest value among its
     * neighbours, because the player walls off the k - 1 best ones. Cells are
     * reached in BFS order, so the k-th neighbour to be finalised is exactly
     * the k-th smallest. Cells that never get k finalised neighbours stay
     * INF: the player can always seal them off.
     */
    function kDistance(g, wall, k, edgeOk, out, countBuf, queueBuf) {
        var dist = out || new Int32Array(g.n);
        var count = countBuf || new Uint8Array(g.n);
        var queue = queueBuf || new Int32Array(g.n);
        var head = 0;
        var tail = 0;
        for (var c0 = 0; c0 < g.n; c0++) {
            dist[c0] = INF;
            count[c0] = 0;
            if (g.edge[c0] && !wall[c0] && (!edgeOk || edgeOk(c0))) {
                dist[c0] = 0;
                queue[tail++] = c0;
            }
        }
        while (head < tail) {
            var c = queue[head++];
            for (var d = 0; d < 6; d++) {
                var m = g.nb[c * 6 + d];
                if (m < 0 || wall[m] || g.edge[m] || dist[m] !== INF) {
                    continue;
                }
                count[m]++;
                if (count[m] === k) {
                    dist[m] = dist[c] + 1;
                    queue[tail++] = m;
                }
            }
        }
        return dist;
    }

    function twoDistance(g, wall, out, countBuf, queueBuf) {
        return kDistance(g, wall, 2, null, out, countBuf, queueBuf);
    }

    // Number of free cells the cat can still reach from start.
    function regionSize(g, wall, start) {
        var seen = new Uint8Array(g.n);
        var queue = new Int32Array(g.n);
        var head = 0;
        var tail = 0;
        seen[start] = 1;
        queue[tail++] = start;
        while (head < tail) {
            var c = queue[head++];
            for (var d = 0; d < 6; d++) {
                var m = g.nb[c * 6 + d];
                if (m >= 0 && !wall[m] && !seen[m]) {
                    seen[m] = 1;
                    queue[tail++] = m;
                }
            }
        }
        return tail;
    }

    /**
     * Smart cat.
     *
     * Under the normal rules (one wall per cat move) it searches two rounds
     * ahead: cat step, the player's best wall, cat step, the player's best
     * wall, then scores the position by two-distance (see lookahead). Looking
     * only one wall ahead, the cat kept turning away from whichever side the
     * player was walling and circled until it was fenced in; the second
     * round lets it see that and run for the side that stays open.
     *
     * With rule variants, or when the search runs out of time or finds every
     * step lost, it falls back to shallowSolver.
     */
    function smartSolver(blocksIsWall, ci, cj, rules) {
        var normal = !rules || ((!rules.blocks || rules.blocks === 1) && !rules.edgeStay);
        if (normal) {
            var w = blocksIsWall.length;
            var h = blocksIsWall[0].length;
            var g = geometry(w, h);
            var d = lookahead(g, toFlat(blocksIsWall, g), ci * h + cj, SEARCH_MS, SEARCH_ROUNDS);
            if (d >= 0) {
                return d;
            }
        }
        return shallowSolver(blocksIsWall, ci, cj, rules);
    }

    var BIG = 1e7;
    var SEARCH_MS = 300;
    // Three rounds was not clearly better in the benchmark and often hit
    // the time limit on 13x13 and up.
    var SEARCH_ROUNDS = 2;
    // Walls tried at the first player turn, best-looking first.
    var SEARCH_WIDTH = 10;

    /**
     * Alpha-beta search: cat step, wall, cat step, wall, then the leaf score
     * (lower is better for the cat). Returns the direction of the best first
     * step, or -1 when there is nothing to decide, the time runs out, or
     * every step loses against best play.
     */
    function lookahead(g, wall, cat, timeLimit, maxRounds) {
        var nb = g.nb;
        var n = g.n;
        var deadline = Date.now() + timeLimit;
        var dist = new Int32Array(n);
        var count = new Uint8Array(n);
        var queue = new Int32Array(n);
        var timeout = {};
        // Two-distance of the cat's best step in the last leaf() call.
        var leafBest = INF;

        // Cat to move, no more searching. An escape next to the cat beats
        // everything and being walled in loses; otherwise the score is the
        // two-distance of the cat's best step, a little better when several
        // steps are that good, so the player cannot cover them all.
        function leaf(pos) {
            var free = 0;
            for (var d = 0; d < 6; d++) {
                var m = nb[pos * 6 + d];
                if (m >= 0 && !wall[m]) {
                    if (g.edge[m]) return -BIG;
                    free++;
                }
            }
            if (free === 0) return BIG;
            kDistance(g, wall, 2, null, dist, count, queue);
            var best = INF;
            var ties = 0;
            leafBest = INF;
            for (var e = 0; e < 6; e++) {
                var y = nb[pos * 6 + e];
                if (y < 0 || wall[y]) continue;
                if (dist[y] < best) {
                    best = dist[y];
                    ties = 1;
                } else if (dist[y] === best) {
                    ties++;
                }
            }
            leafBest = best;
            if (best < INF) {
                return best * 100 - ties * 10;
            }
            // The player can seal every route; the shorter the plain way out,
            // the better the chance the player misses it.
            edgeDistance(g, wall, dist);
            var plain = INF;
            for (var f = 0; f < 6; f++) {
                var z = nb[pos * 6 + f];
                if (z >= 0 && !wall[z] && dist[z] < plain) plain = dist[z];
            }
            return plain < INF ? 100000 + plain * 100 : BIG / 2;
        }

        function catNode(pos, depth, alpha, beta, ply) {
            var free = 0;
            for (var d = 0; d < 6; d++) {
                var m = nb[pos * 6 + d];
                if (m >= 0 && !wall[m]) {
                    if (g.edge[m]) return -BIG + ply;
                    free++;
                }
            }
            if (free === 0) return BIG - ply;
            if (depth === 0) return leaf(pos);
            // Most promising steps first, so the bounds tighten early.
            kDistance(g, wall, 2, null, dist, count, queue);
            var steps = [];
            for (var e = 0; e < 6; e++) {
                var y = nb[pos * 6 + e];
                if (y >= 0 && !wall[y]) steps.push(y);
            }
            steps.sort(function (a, b) { return dist[a] - dist[b]; });
            var best = Infinity;
            for (var t = 0; t < steps.length; t++) {
                var v = playerNode(steps[t], depth - 1, alpha, Math.min(beta, best), ply + 1);
                if (v < best) {
                    best = v;
                    if (best <= alpha) break;
                }
            }
            return best;
        }

        // Walls worth trying against a cat on pos. A cell's two-distance
        // only depends on cells with smaller values, so a wall on a cell at
        // least as far out as the cat's best step leaves the leaf score as it
        // is (unless it is right next to the cat). Fills out with cells, and
        // returns false when every other wall keeps the score at `base`.
        function relevantWalls(pos, base, out) {
            var x;
            if (base === -BIG) {
                for (var d = 0; d < 6; d++) {
                    x = nb[pos * 6 + d];
                    if (x >= 0 && !wall[x]) out.push(x);
                }
                return true;
            }
            var limit = leafBest;
            for (x = 0; x < n; x++) {
                if (wall[x] || x === pos) continue;
                if (limit >= INF || dist[x] < limit || isNeighbour(pos, x)) out.push(x);
            }
            return limit < INF;
        }

        function isNeighbour(a, b) {
            for (var d = 0; d < 6; d++) {
                if (nb[a * 6 + d] === b) return true;
            }
            return false;
        }

        function playerNode(pos, depth, alpha, beta, ply) {
            if (Date.now() > deadline) throw timeout;
            var base = leaf(pos);
            if (base >= BIG) return base;
            var cells = [];
            var others = relevantWalls(pos, base, cells);
            var scores = [];
            var x;
            var t;
            for (t = 0; t < cells.length; t++) {
                x = cells[t];
                wall[x] = 1;
                var s = leaf(pos);
                wall[x] = 0;
                if (depth === 0 && s >= beta) return s;
                scores.push(s);
            }
            if (depth === 0) {
                var top = others ? base : -Infinity;
                for (t = 0; t < scores.length; t++) {
                    if (scores[t] > top) top = scores[t];
                }
                return top;
            }
            var order = cells.map(function (c, idx) { return idx; });
            order.sort(function (a, b) { return scores[b] - scores[a]; });
            var best = -Infinity;
            for (t = 0; t < order.length && t < SEARCH_WIDTH; t++) {
                x = cells[order[t]];
                wall[x] = 1;
                var v = catNode(pos, depth, Math.max(alpha, best), beta, ply + 1);
                wall[x] = 0;
                if (v > best) {
                    best = v;
                    if (best >= beta) return best;
                }
            }
            // Any other wall changes nothing right now; searching on as if
            // the player passed is a lower bound for all of them.
            if (others) {
                var pass = catNode(pos, depth, Math.max(alpha, best), beta, ply + 1);
                if (pass > best) best = pass;
            }
            return best;
        }

        var dirs = [];
        for (var d = 0; d < 6; d++) {
            var m = nb[cat * 6 + d];
            if (m < 0 || wall[m]) continue;
            if (g.edge[m]) return d;
            dirs.push(d);
        }
        kDistance(g, wall, 2, null, dist, count, queue);
        dirs.sort(function (a, b) { return dist[nb[cat * 6 + a]] - dist[nb[cat * 6 + b]] || a - b; });
        // Iterative deepening: keep the answer of the deepest search that
        // finished in time, and try the previous best step first.
        var answer = -1;
        for (var rounds = 2; rounds <= maxRounds; rounds++) {
            var bestD = -1;
            var bestV = Infinity;
            try {
                for (var r = 0; r < dirs.length; r++) {
                    var v = playerNode(nb[cat * 6 + dirs[r]], rounds - 1, -Infinity, bestV, 1);
                    if (v < bestV) {
                        bestV = v;
                        bestD = dirs[r];
                    }
                }
            } catch (e) {
                if (e !== timeout) throw e;
                break;
            }
            if (bestV >= BIG / 2) return -1;
            answer = bestD;
            // Escaping or losing by force does not change with more depth.
            if (bestV < -BIG / 2) break;
            dirs.splice(dirs.indexOf(bestD), 1);
            dirs.unshift(bestD);
        }
        return answer;
    }

    /**
     * One-wall lookahead. Used by smartSolver for the rule variants, when the
     * deeper search runs out of time, and when the cat is trapped anyway.
     *
     * 1. Step onto a free edge cell if there is one (that is an instant escape).
     * 2. Otherwise look one player move ahead: for each step the cat could take,
     *    try every wall the player could place next, and score the step by the
     *    worst case. Score = two-distance of the cat's best follow-up step, so
     *    walls that cut off several routes at once are taken into account.
     * 3. If the player can trap the cat no matter what (all scores INF), fall
     *    back to the same worst-case search with plain distance, hoping the
     *    player misses the right wall.
     * 4. If there is no way to the edge at all, keep walking inside the
     *    enclosure instead of giving up, so the player has to fill it in.
     *
     * rules (optional) describes the variant being played:
     *   blocks:   walls the player places before the cat's next move (default 1)
     *   edgeStay: the cat has to wait one turn on an edge cell before it can
     *             leave, and is caught there if the player walls it in
     */
    function shallowSolver(blocksIsWall, ci, cj, rules) {
        var w = blocksIsWall.length;
        var h = blocksIsWall[0].length;
        var g = geometry(w, h);
        var wall = toFlat(blocksIsWall, g);
        var cat = ci * h + cj;
        var blocks = rules && rules.blocks > 0 ? rules.blocks : 1;
        var k = blocks + 1;

        // With edgeStay an edge cell is only a way out if the player cannot
        // wall in all of its free neighbours during the wait.
        var edgeOk = rules && rules.edgeStay ? function (e) {
            return freeNeighbours(g, wall, e) > blocks;
        } : null;

        var steps = [];
        var riskyEdges = [];
        for (var d = 0; d < 6; d++) {
            var m = g.nb[cat * 6 + d];
            if (m >= 0 && !wall[m]) {
                if (g.edge[m]) {
                    if (!edgeOk || edgeOk(m)) {
                        return d;
                    }
                    riskyEdges.push(d);
                } else {
                    steps.push({d: d, k: m});
                }
            }
        }
        if (steps.length === 0) {
            return riskyEdges.length ? riskyEdges[0] : -1;
        }

        var bufDist = new Int32Array(g.n);
        var bufCount = new Uint8Array(g.n);
        var bufQueue = new Int32Array(g.n);
        var baseTwo = kDistance(g, wall, k, edgeOk, new Int32Array(g.n), bufCount, bufQueue);
        var baseOne = edgeDistance(g, wall, new Int32Array(g.n));
        var vals = [];

        // The cat's best follow-up from pos that the player cannot also wall
        // off: the player still has blocks - 1 walls after the one tried.
        function bestFollowUp(pos, dist) {
            vals.length = 0;
            for (var dd = 0; dd < 6; dd++) {
                var y = g.nb[pos * 6 + dd];
                if (y >= 0 && !wall[y]) {
                    vals.push(dist[y]);
                }
            }
            if (vals.length < blocks) {
                return INF;
            }
            vals.sort(function (a, b) { return a - b; });
            return vals[blocks - 1];
        }

        // Worst-case value of standing on `pos` after the player places one
        // more wall, measured with `metric` (twoDistance or edgeDistance).
        function worstCase(pos, metric) {
            var worst = -1;
            for (var x = 0; x < g.n; x++) {
                if (wall[x] || x === pos) {
                    continue;
                }
                wall[x] = 1;
                var dist = metric === twoDistance
                    ? kDistance(g, wall, k, edgeOk, bufDist, bufCount, bufQueue)
                    : edgeDistance(g, wall, bufDist);
                var best = bestFollowUp(pos, dist);
                wall[x] = 0;
                if (best > worst) {
                    worst = best;
                    if (worst >= INF) {
                        break;
                    }
                }
            }
            return worst;
        }

        function pick(metric, baseline) {
            var best = null;
            for (var s = 0; s < steps.length; s++) {
                var step = steps[s];
                var score = worstCase(step.k, metric);
                var cand = {
                    d: step.d,
                    score: score,
                    base: baseline[step.k],
                    one: baseOne[step.k],
                    free: freeNeighbours(g, wall, step.k),
                };
                if (best === null || better(cand, best)) {
                    best = cand;
                }
            }
            return best;
        }

        var choice = pick(twoDistance, baseTwo);
        if (choice.score < INF) {
            return choice.d;
        }
        if (baseOne[cat] < INF) {
            choice = pick(edgeDistance, baseOne);
            return choice.d;
        }

        // Enclosed: stay alive as long as possible.
        var bestD = steps[0].d;
        var bestScore = -1;
        for (var t = 0; t < steps.length; t++) {
            var score = freeNeighbours(g, wall, steps[t].k) * 1000 + regionSize(g, wall, steps[t].k);
            if (score > bestScore) {
                bestScore = score;
                bestD = steps[t].d;
            }
        }
        return bestD;
    }

    function freeNeighbours(g, wall, k) {
        var c = 0;
        for (var d = 0; d < 6; d++) {
            var m = g.nb[k * 6 + d];
            if (m >= 0 && !wall[m]) {
                c++;
            }
        }
        return c;
    }

    // Lower score first, then lower two-distance, lower plain distance, more room.
    function better(a, b) {
        if (a.score !== b.score) return a.score < b.score;
        if (a.base !== b.base) return a.base < b.base;
        if (a.one !== b.one) return a.one < b.one;
        return a.free > b.free;
    }

    /**
     * The cat that ships on https://ganlvtech.github.io/phaser-catch-the-cat/
     * (ported from its catch-the-cat.js build). It walks along a shortest path
     * to the edge, preferring the neighbour with the most shortest routes, and
     * gives up as soon as there is no path.
     */
    function classicSolver(blocksIsWall, ci, cj) {
        var w = blocksIsWall.length;
        var h = blocksIsWall[0].length;
        var g = geometry(w, h);
        var wall = toFlat(blocksIsWall, g);
        var dist = new Int32Array(g.n);
        var queue = new Int32Array(g.n);
        var head = 0;
        var tail = 0;
        for (var k = 0; k < g.n; k++) {
            dist[k] = INF;
            if (g.edge[k] && !wall[k]) {
                dist[k] = 0;
                queue[tail++] = k;
            }
        }
        while (head < tail) {
            var c = queue[head++];
            for (var d = 0; d < 6; d++) {
                var m = g.nb[c * 6 + d];
                if (m >= 0 && !g.edge[m] && !wall[m] && dist[m] > dist[c] + 1) {
                    dist[m] = dist[c] + 1;
                    queue[tail++] = m;
                }
            }
        }
        var routes = new Float64Array(g.n).fill(-1);

        function routesCount(x) {
            if (routes[x] >= 0) return routes[x];
            if (g.edge[x]) return (routes[x] = 1);
            var r = 0;
            for (var d = 0; d < 6; d++) {
                var y = g.nb[x * 6 + d];
                if (y >= 0 && !wall[y] && dist[y] < dist[x]) {
                    r += routesCount(y);
                }
            }
            return (routes[x] = r);
        }

        var cat = ci * h + cj;
        var best = 0;
        var dir = -1;
        for (var d2 = 0; d2 < 6; d2++) {
            var y = g.nb[cat * 6 + d2];
            if (y >= 0 && !wall[y] && dist[y] < dist[cat]) {
                var r = routesCount(y);
                if (r > best) {
                    best = r;
                    dir = d2;
                }
            }
        }
        return dir;
    }

    /**
     * Rule variants, shared by the page and the simulator:
     *   wallsPerTurn: walls the player places before the cat moves (1 or 2)
     *   napEvery:     the cat skips every n-th of its turns (0 = never)
     *   edgeStay:     the cat waits one turn on the edge before leaving
     * Returns how many walls the player gets between the cat move it is
     * making now (its catTurn-th turn) and its next real move.
     */
    function wallsBeforeNextMove(rules, catTurn) {
        var per = (rules && rules.wallsPerTurn) || 1;
        var nap = (rules && rules.napEvery) || 0;
        var total = 0;
        var t = catTurn + 1;
        for (;;) {
            total += per;
            if (nap && t % nap === 0) {
                t++;
            } else {
                return total;
            }
        }
    }

    return {
        INF: INF,
        wallsBeforeNextMove: wallsBeforeNextMove,
        getNeighbours: getNeighbours,
        geometry: geometry,
        toFlat: toFlat,
        edgeDistance: edgeDistance,
        twoDistance: twoDistance,
        kDistance: kDistance,
        smartSolver: smartSolver,
        shallowSolver: shallowSolver,
        classicSolver: classicSolver,
    };
});
