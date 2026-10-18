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
     * "Two-distance": how many cat moves it takes to escape from a cell when
     * the player moves first and always blocks the cat's best next step.
     *
     * An edge cell is 0. Any other cell is 1 + the second smallest value among
     * its neighbours, because the player will wall off the smallest one.
     * Cells reached in BFS order, so the second neighbour to be finalised is
     * exactly the second smallest. Cells that never get two finalised
     * neighbours stay INF: the player can always seal them off.
     */
    function twoDistance(g, wall, out, countBuf, queueBuf) {
        var dist = out || new Int32Array(g.n);
        var count = countBuf || new Uint8Array(g.n);
        var queue = queueBuf || new Int32Array(g.n);
        var head = 0;
        var tail = 0;
        for (var k = 0; k < g.n; k++) {
            dist[k] = INF;
            count[k] = 0;
            if (g.edge[k] && !wall[k]) {
                dist[k] = 0;
                queue[tail++] = k;
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
                if (count[m] === 2) {
                    dist[m] = dist[c] + 1;
                    queue[tail++] = m;
                }
            }
        }
        return dist;
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
     */
    function smartSolver(blocksIsWall, ci, cj) {
        var w = blocksIsWall.length;
        var h = blocksIsWall[0].length;
        var g = geometry(w, h);
        var wall = toFlat(blocksIsWall, g);
        var cat = ci * h + cj;

        var steps = [];
        for (var d = 0; d < 6; d++) {
            var m = g.nb[cat * 6 + d];
            if (m >= 0 && !wall[m]) {
                if (g.edge[m]) {
                    return d;
                }
                steps.push({d: d, k: m});
            }
        }
        if (steps.length === 0) {
            return -1;
        }

        var bufDist = new Int32Array(g.n);
        var bufCount = new Uint8Array(g.n);
        var bufQueue = new Int32Array(g.n);
        var baseTwo = twoDistance(g, wall, new Int32Array(g.n), bufCount, bufQueue);
        var baseOne = edgeDistance(g, wall, new Int32Array(g.n));

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
                    ? twoDistance(g, wall, bufDist, bufCount, bufQueue)
                    : edgeDistance(g, wall, bufDist);
                var best = INF;
                for (var dd = 0; dd < 6; dd++) {
                    var y = g.nb[pos * 6 + dd];
                    if (y >= 0 && !wall[y] && dist[y] < best) {
                        best = dist[y];
                    }
                }
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

    return {
        INF: INF,
        getNeighbours: getNeighbours,
        geometry: geometry,
        toFlat: toFlat,
        edgeDistance: edgeDistance,
        twoDistance: twoDistance,
        smartSolver: smartSolver,
        classicSolver: classicSolver,
    };
});
