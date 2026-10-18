/*!
 * The cat's Go AI: Monte Carlo tree search with RAVE (all-moves-as-first).
 *
 * Every simulation walks down the tree, then finishes the game with fast
 * semi-random moves (never fills its own eyes, captures or escapes ataris
 * next to the last move) and counts the area. Moves that win more often get
 * explored more. RAVE also credits a move for wins in any simulation where
 * the same player played that point later, which makes a 9x9 search
 * converge much faster.
 *
 * Needs GoEngine (src/go-engine.js). Works in a Web Worker and in Node.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./go-engine.js"));
    } else {
        root.GoAI = factory(root.GoEngine);
    }
})(typeof self !== "undefined" ? self : this, function (GoEngine) {
    "use strict";

    var EMPTY = GoEngine.EMPTY;
    var BLACK = GoEngine.BLACK;
    var WHITE = GoEngine.WHITE;
    var PASS = GoEngine.PASS;

    // Silver's RAVE schedule: beta = n~ / (n + n~ + 4 b^2 n n~)
    var RAVE_BIAS = 0.0025;
    var EXPLORATION = 0.1;

    function rng(seed) {
        var a = seed >>> 0;
        return function () {
            a = (a + 0x6d2b79f5) >>> 0;
            var t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function Node(move, player, parent) {
        this.move = move;
        this.player = player; // who played `move` to reach this node
        this.parent = parent;
        this.children = null;
        this.n = 0;
        this.w = 0;
        this.an = 0;
        this.aw = 0;
    }

    // Legal moves for the side to play that do not fill its own eyes.
    function candidateMoves(board) {
        var out = [];
        var c = board.cells;
        var me = board.toPlay;
        for (var p = 0; p < c.length; p++) {
            if (c[p] === EMPTY && !board.isEye(p, me) && board.isLegal(p)) {
                out.push(p);
            }
        }
        return out;
    }

    var scratch = {};

    function scratchBoard(board) {
        var b = scratch[board.n];
        if (!b) {
            b = scratch[board.n] = new GoEngine.Board(board.n);
        }
        return b.copyFrom(board);
    }

    /**
     * Go sense, added to a new child as virtual RAVE results so the search
     * looks at sensible moves first: capturing and saving stones in atari
     * is good, putting your own stones in atari or crawling on the first
     * line early is bad.
     */
    function prior(board, p) {
        var c = board.cells;
        var me = board.toPlay;
        var opp = 3 - me;
        var off = [-1, 1, -board.w, board.w];
        var captures = 0;
        var saves = 0;
        for (var k = 0; k < 4; k++) {
            var q = p + off[k];
            if (c[q] === opp && board.atariLiberty(q) === p) {
                captures += GoEngine.groupAt(board, q).length;
            } else if (c[q] === me && board.atariLiberty(q) === p) {
                saves += GoEngine.groupAt(board, q).length;
            }
        }
        var after = scratchBoard(board);
        after.play(p);
        var libsAfter = after.liberties(p, 3);
        var xy = board.xy(p);
        var line = Math.min(xy[0], xy[1], board.n - 1 - xy[0], board.n - 1 - xy[1]);

        if (captures > 0) return [80 + 10 * captures, 0.9];
        if (saves > 0 && libsAfter >= 3) return [80, 0.85];
        if (libsAfter === 1) return [60, 0.05];
        if (saves > 0) return [30, 0.6];
        if (line === 0 && board.moves < board.n * 2) return [40, 0.15];
        return null;
    }

    function expand(node, board) {
        var moves = candidateMoves(board);
        if (moves.length === 0) {
            moves.push(PASS);
        }
        var player = board.toPlay;
        node.children = moves.map(function (m) {
            var child = new Node(m, player, node);
            if (m !== PASS) {
                var pr = prior(board, m);
                if (pr) {
                    child.an = pr[0];
                    child.aw = pr[0] * pr[1];
                    // A few virtual real visits too, so one unlucky playout
                    // cannot bury a good capture.
                    child.n = pr[0] / 8;
                    child.w = child.n * pr[1];
                }
            }
            return child;
        });
    }

    function select(node, random) {
        var best = null;
        var bestValue = -Infinity;
        var logN = Math.log(node.n + 1);
        var kids = node.children;
        for (var i = 0; i < kids.length; i++) {
            var ch = kids[i];
            var q = ch.n > 0 ? ch.w / ch.n : 0.5;
            var aq = ch.an > 0 ? ch.aw / ch.an : 0.5;
            var beta = ch.an > 0 ? ch.an / (ch.n + ch.an + 4 * RAVE_BIAS * ch.n * ch.an) : 0;
            var value = (1 - beta) * q + beta * aq +
                EXPLORATION * Math.sqrt(logN / (ch.n + 1)) +
                random() * 1e-6;
            if (value > bestValue) {
                bestValue = value;
                best = ch;
            }
        }
        return best;
    }

    /**
     * Fast playout policy. Looks around the last two moves first: capture an
     * opponent group in atari, or save an own group in atari. Otherwise a
     * random legal move that does not fill an own eye.
     */
    function playoutMove(board, random, empties) {
        var c = board.cells;
        var me = board.toPlay;
        if (random() < 0.9) {
            var off = [0, -1, 1, -board.w, board.w];
            var recent = [board.lastMove, board.prevMove];
            for (var r = 0; r < 2; r++) {
                var last = recent[r];
                if (last === PASS) continue;
                for (var k = 0; k < 5; k++) {
                    var q = last + off[k];
                    var v = c[q];
                    if (v !== BLACK && v !== WHITE) continue;
                    var lib = board.atariLiberty(q);
                    if (lib >= 0 && !board.isEye(lib, me) && board.isLegal(lib)) {
                        return lib;
                    }
                }
            }
        }
        var count = 0;
        for (var p = 0; p < c.length; p++) {
            if (c[p] === EMPTY) empties[count++] = p;
        }
        while (count > 0) {
            var i = (random() * count) | 0;
            var m = empties[i];
            if (!board.isEye(m, me) && board.isLegal(m)) {
                return m;
            }
            empties[i] = empties[--count];
        }
        return PASS;
    }

    /**
     * Searches from `board` (not modified).
     * opts: {komi, timeMs, maxPlayouts, seed}
     * Returns {move, winrate, playouts, ownership, children}
     *   winrate: chance the side to move wins after `move`, 0..1
     *   ownership: per point, +1 Black owns at the end ... -1 White owns
     */
    function search(board, opts) {
        opts = opts || {};
        var komi = opts.komi === undefined ? 7.5 : opts.komi;
        var timeMs = opts.timeMs === undefined ? 1000 : opts.timeMs;
        var maxPlayouts = opts.maxPlayouts || Infinity;
        var random = rng(opts.seed === undefined ? (Math.random() * 4294967296) >>> 0 : opts.seed);
        var now = typeof performance !== "undefined" ? function () { return performance.now(); } : Date.now;

        var root = new Node(PASS, 3 - board.toPlay, null);
        expand(root, board);

        var size = board.cells.length;
        var empties = new Int32Array(size);
        var seenBlack = new Uint32Array(size + 1);
        var seenWhite = new Uint32Array(size + 1);
        var stamp = 0;
        var ownership = new Float64Array(size);
        var maxLen = board.n * board.n * 3;
        var seq = new Int32Array(maxLen + 64);
        var seqColor = new Uint8Array(maxLen + 64);
        var path = [];

        var start = now();
        var playouts = 0;
        while (playouts < maxPlayouts && (playouts & 63 || now() - start < timeMs)) {
            var b = board.clone();
            var node = root;
            path.length = 0;
            path.push(root);

            // Selection and expansion
            while (node.children && node.children.length && !b.isOver()) {
                node = select(node, random);
                b.play(node.move);
                path.push(node);
                if (node.n === 0) break;
            }
            if (node.n > 0 && node.children === null && !b.isOver()) {
                expand(node, b);
                node = select(node, random);
                b.play(node.move);
                path.push(node);
            }

            // Playout
            var len = 0;
            while (!b.isOver() && len < maxLen) {
                var color = b.toPlay;
                var m = playoutMove(b, random, empties);
                b.play(m);
                seq[len] = m;
                seqColor[len] = color;
                len++;
            }

            var result = GoEngine.areaScore(b, komi);
            var winner = result.score > 0 ? BLACK : WHITE;
            var owner = result.owner;
            for (var p = 0; p < size; p++) {
                if (owner[p] === BLACK) ownership[p] += 1;
                else if (owner[p] === WHITE) ownership[p] -= 1;
            }

            // Backpropagation with AMAF
            stamp++;
            for (var s = 0; s < len; s++) {
                if (seq[s] === PASS) continue;
                if (seqColor[s] === BLACK) seenBlack[seq[s]] = stamp;
                else seenWhite[seq[s]] = stamp;
            }
            for (var i = path.length - 1; i >= 0; i--) {
                var nd = path[i];
                nd.n++;
                if (nd.player === winner) nd.w++;
                if (nd.children) {
                    for (var j = 0; j < nd.children.length; j++) {
                        var ch = nd.children[j];
                        if (ch.move === PASS) continue;
                        var seen = ch.player === BLACK ? seenBlack : seenWhite;
                        if (seen[ch.move] === stamp) {
                            ch.an++;
                            if (ch.player === winner) ch.aw++;
                        }
                    }
                }
                if (nd.move !== PASS) {
                    if (nd.player === BLACK) seenBlack[nd.move] = stamp;
                    else seenWhite[nd.move] = stamp;
                }
            }
            playouts++;
        }

        var best = null;
        for (var k = 0; k < root.children.length; k++) {
            var c = root.children[k];
            if (best === null || c.n > best.n) best = c;
        }
        for (var q = 0; q < size; q++) {
            ownership[q] /= Math.max(1, playouts);
        }
        var all = {};
        root.children.forEach(function (ch) {
            all[ch.move] = {visits: ch.n, winrate: ch.n > 0 ? ch.w / ch.n : 0};
        });
        return {
            all: all,
            move: best.move,
            winrate: best.n > 0 ? best.w / best.n : 0.5,
            playouts: playouts,
            ownership: Array.prototype.slice.call(ownership),
            children: root.children
                .filter(function (ch) { return ch.n > 0; })
                .sort(function (a, b) { return b.n - a.n; })
                .slice(0, 5)
                .map(function (ch) { return {move: ch.move, visits: ch.n, winrate: ch.w / ch.n}; }),
        };
    }

    /**
     * Guesses which stones are dead at the end of the game: groups whose
     * points end up owned by the other side in most random continuations.
     */
    function estimateDead(board, opts) {
        opts = opts || {};
        var komi = opts.komi === undefined ? 7.5 : opts.komi;
        var playouts = opts.playouts || 600;
        var random = rng(opts.seed === undefined ? 12345 : opts.seed);
        var size = board.cells.length;
        var own = new Float64Array(size);
        var empties = new Int32Array(size);
        var maxLen = board.n * board.n * 3;
        for (var i = 0; i < playouts; i++) {
            var b = board.clone();
            // Alternate who moves first so neither side gets a free tempo.
            b.toPlay = i % 2 === 0 ? BLACK : WHITE;
            b.passes = 0;
            b.ko = -1;
            var len = 0;
            while (!b.isOver() && len < maxLen) {
                b.play(playoutMove(b, random, empties));
                len++;
            }
            var owner = GoEngine.areaScore(b, komi).owner;
            for (var p = 0; p < size; p++) {
                if (owner[p] === BLACK) own[p] += 1;
                else if (owner[p] === WHITE) own[p] -= 1;
            }
        }
        var dead = [];
        var done = new Uint8Array(size);
        for (var q = 0; q < size; q++) {
            var v = board.cells[q];
            if ((v !== BLACK && v !== WHITE) || done[q]) continue;
            var group = GoEngine.groupAt(board, q);
            var sum = 0;
            for (var g = 0; g < group.length; g++) {
                done[group[g]] = 1;
                sum += own[group[g]] / playouts;
            }
            var avg = sum / group.length;
            if ((v === BLACK && avg < -0.5) || (v === WHITE && avg > 0.5)) {
                Array.prototype.push.apply(dead, group);
            }
        }
        return dead;
    }

    /**
     * Obvious tactics the random playouts tend to undervalue: the biggest
     * capture of a group in atari, or saving an own group in atari when the
     * escape gets it at least 3 liberties. Returns {move, size} or null.
     */
    function tacticalMove(board) {
        var c = board.cells;
        var me = board.toPlay;
        var opp = 3 - me;
        var done = new Uint8Array(c.length);
        var best = null;
        for (var p = 0; p < c.length; p++) {
            var v = c[p];
            if ((v !== BLACK && v !== WHITE) || done[p]) continue;
            var group = GoEngine.groupAt(board, p);
            for (var g = 0; g < group.length; g++) done[group[g]] = 1;
            var lib = board.atariLiberty(p);
            if (lib < 0 || !board.isLegal(lib)) continue;
            var value = 0;
            if (v === opp) {
                value = group.length + 0.5;
            } else {
                var after = scratchBoard(board);
                after.play(lib);
                if (after.liberties(lib, 3) >= 3) value = group.length;
            }
            if (value > 0 && (best === null || value > best.size)) {
                best = {move: lib, size: value};
            }
        }
        return best;
    }

    /**
     * What the cat plays. Returns {move, resign, winrate, playouts, ...}.
     * - If the opponent just passed and the cat is ahead after removing dead
     *   stones, it passes too and the game ends.
     * - If its winning chance is hopeless late in the game, it resigns.
     */
    function chooseMove(board, opts) {
        opts = opts || {};
        var komi = opts.komi === undefined ? 7.5 : opts.komi;
        var me = board.toPlay;
        var result = search(board, opts);
        var tactic = null;
        if (opts.temperature > 0 && result.children.length > 1) {
            // Beginner-friendly cat: sometimes picks one of its other top moves.
            var weights = result.children.map(function (ch) {
                return Math.pow(ch.visits, 1 / opts.temperature);
            });
            var total = weights.reduce(function (a, b) { return a + b; }, 0);
            var roll = Math.random() * total;
            for (var i = 0; i < weights.length; i++) {
                roll -= weights[i];
                if (roll <= 0) {
                    result.move = result.children[i].move;
                    result.winrate = result.children[i].winrate;
                    break;
                }
            }
        } else {
            tactic = tacticalMove(board);
        }
        if (tactic && tactic.move !== result.move) {
            var stats = result.all[tactic.move];
            if (stats && stats.visits > 0 && stats.winrate >= result.winrate - 0.08) {
                result.move = tactic.move;
                result.winrate = stats.winrate;
                result.tactic = true;
            }
        }
        if (board.passes === 1) {
            var dead = estimateDead(board, {komi: komi, playouts: opts.deadPlayouts || 400});
            var score = GoEngine.areaScore(board, komi, dead).score;
            if ((me === BLACK && score > 0) || (me === WHITE && score < 0)) {
                result.move = PASS;
                result.dead = dead;
            }
        }
        result.resign = result.move !== PASS && result.winrate < 0.04 && board.moves > board.n * 2;
        return result;
    }

    return {
        search: search,
        chooseMove: chooseMove,
        estimateDead: estimateDead,
        candidateMoves: candidateMoves,
    };
});
