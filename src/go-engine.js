/*!
 * Go rules for the "play Go with the cat" page.
 *
 * Board points are stored in a flat array with a one-cell border, so point
 * p = (y + 1) * (n + 2) + (x + 1) and its neighbours are p +- 1, p +- (n + 2).
 * Rules: captures, no suicide, simple ko, two passes in a row end the game,
 * area scoring (stones + surrounded empty points) with komi.
 *
 * Works in the browser / Web Worker (self.GoEngine) and in Node.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.GoEngine = factory();
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var EMPTY = 0;
    var BLACK = 1;
    var WHITE = 2;
    var EDGE = 3;
    var PASS = -1;

    function Board(n) {
        var w = n + 2;
        this.n = n;
        this.w = w;
        this.cells = new Uint8Array(w * w);
        for (var i = 0; i < w * w; i++) {
            var x = i % w;
            var y = (i / w) | 0;
            if (x === 0 || y === 0 || x === w - 1 || y === w - 1) {
                this.cells[i] = EDGE;
            }
        }
        this.toPlay = BLACK;
        this.ko = -1;
        this.passes = 0;
        this.captures = [0, 0, 0];
        this.moves = 0;
        this.lastMove = PASS;
        this.prevMove = PASS;
        this._initScratch();
    }

    Board.prototype._initScratch = function () {
        var len = this.w * this.w;
        this._off = [-1, 1, -this.w, this.w];
        this._mark = new Uint32Array(len);
        this._gen = 0;
        this._stack = new Int32Array(len);
    };

    Board.prototype.point = function (x, y) {
        return (y + 1) * this.w + (x + 1);
    };

    Board.prototype.xy = function (p) {
        return [(p % this.w) - 1, ((p / this.w) | 0) - 1];
    };

    Board.prototype.get = function (x, y) {
        return this.cells[this.point(x, y)];
    };

    Board.prototype.clone = function () {
        var b = Object.create(Board.prototype);
        b.n = this.n;
        b.w = this.w;
        b.cells = this.cells.slice();
        b.toPlay = this.toPlay;
        b.ko = this.ko;
        b.passes = this.passes;
        b.captures = this.captures.slice();
        b.moves = this.moves;
        b.lastMove = this.lastMove;
        b.prevMove = this.prevMove;
        b._initScratch();
        return b;
    };

    // Copies the position of another board of the same size into this one.
    Board.prototype.copyFrom = function (other) {
        this.cells.set(other.cells);
        this.toPlay = other.toPlay;
        this.ko = other.ko;
        this.passes = other.passes;
        this.captures[1] = other.captures[1];
        this.captures[2] = other.captures[2];
        this.moves = other.moves;
        this.lastMove = other.lastMove;
        this.prevMove = other.prevMove;
        return this;
    };

    Board.prototype.toJSON = function () {
        return {
            n: this.n,
            cells: Array.prototype.slice.call(this.cells),
            toPlay: this.toPlay,
            ko: this.ko,
            passes: this.passes,
            captures: this.captures.slice(),
            moves: this.moves,
            lastMove: this.lastMove,
            prevMove: this.prevMove,
        };
    };

    Board.fromJSON = function (data) {
        var b = new Board(data.n);
        b.cells = Uint8Array.from(data.cells);
        b.toPlay = data.toPlay;
        b.ko = data.ko;
        b.passes = data.passes;
        b.captures = data.captures.slice();
        b.moves = data.moves;
        b.lastMove = data.lastMove;
        b.prevMove = data.prevMove === undefined ? PASS : data.prevMove;
        return b;
    };

    // Does the group containing p have at least one liberty?
    Board.prototype._hasLiberty = function (p) {
        var c = this.cells;
        var color = c[p];
        var off = this._off;
        var mark = this._mark;
        var stack = this._stack;
        var gen = ++this._gen;
        var sp = 0;
        stack[sp++] = p;
        mark[p] = gen;
        while (sp > 0) {
            var q = stack[--sp];
            for (var k = 0; k < 4; k++) {
                var r = q + off[k];
                var v = c[r];
                if (v === EMPTY) {
                    return true;
                }
                if (v === color && mark[r] !== gen) {
                    mark[r] = gen;
                    stack[sp++] = r;
                }
            }
        }
        return false;
    };

    /**
     * The only liberty of the group at p, or -1 when it has none or several.
     */
    Board.prototype.atariLiberty = function (p) {
        var c = this.cells;
        var color = c[p];
        var off = this._off;
        var mark = this._mark;
        var stack = this._stack;
        var gen = ++this._gen;
        var sp = 0;
        var lib = -1;
        stack[sp++] = p;
        mark[p] = gen;
        while (sp > 0) {
            var q = stack[--sp];
            for (var k = 0; k < 4; k++) {
                var r = q + off[k];
                var v = c[r];
                if (v === EMPTY) {
                    if (lib === -1) {
                        lib = r;
                    } else if (lib !== r) {
                        return -1;
                    }
                } else if (v === color && mark[r] !== gen) {
                    mark[r] = gen;
                    stack[sp++] = r;
                }
            }
        }
        return lib;
    };

    // Number of liberties of the group at p, counting no further than `max`.
    Board.prototype.liberties = function (p, max) {
        var c = this.cells;
        var color = c[p];
        var off = this._off;
        var mark = this._mark;
        var stack = this._stack;
        var gen = ++this._gen;
        var sp = 0;
        var libs = 0;
        stack[sp++] = p;
        mark[p] = gen;
        while (sp > 0) {
            var q = stack[--sp];
            for (var k = 0; k < 4; k++) {
                var r = q + off[k];
                if (mark[r] === gen) continue;
                var v = c[r];
                if (v === EMPTY) {
                    mark[r] = gen;
                    if (++libs >= max) return libs;
                } else if (v === color) {
                    mark[r] = gen;
                    stack[sp++] = r;
                }
            }
        }
        return libs;
    };

    Board.prototype._removeGroup = function (p) {
        var c = this.cells;
        var color = c[p];
        var off = this._off;
        var stack = this._stack;
        var sp = 0;
        var count = 0;
        stack[sp++] = p;
        c[p] = EMPTY;
        while (sp > 0) {
            var q = stack[--sp];
            count++;
            for (var k = 0; k < 4; k++) {
                var r = q + off[k];
                if (c[r] === color) {
                    c[r] = EMPTY;
                    stack[sp++] = r;
                }
            }
        }
        return count;
    };

    Board.prototype.isLegal = function (p) {
        if (p === PASS) {
            return true;
        }
        var c = this.cells;
        if (p < 0 || p >= c.length || c[p] !== EMPTY || p === this.ko) {
            return false;
        }
        var off = this._off;
        for (var k = 0; k < 4; k++) {
            if (c[p + off[k]] === EMPTY) {
                return true;
            }
        }
        var me = this.toPlay;
        var opp = 3 - me;
        c[p] = me;
        var ok = false;
        for (var k2 = 0; k2 < 4 && !ok; k2++) {
            var q = p + off[k2];
            if (c[q] === opp && !this._hasLiberty(q)) {
                ok = true;
            }
        }
        if (!ok) {
            ok = this._hasLiberty(p);
        }
        c[p] = EMPTY;
        return ok;
    };

    /**
     * Plays p (or PASS) for the side to move. Returns false and leaves the
     * board unchanged when the move is illegal.
     */
    Board.prototype.play = function (p) {
        if (p === PASS) {
            this.passes++;
            this.ko = -1;
            this.toPlay = 3 - this.toPlay;
            this.moves++;
            this.prevMove = this.lastMove;
            this.lastMove = PASS;
            return true;
        }
        var c = this.cells;
        if (p < 0 || p >= c.length || c[p] !== EMPTY || p === this.ko) {
            return false;
        }
        var me = this.toPlay;
        var opp = 3 - me;
        var off = this._off;
        c[p] = me;
        var captured = 0;
        var capPoint = -1;
        for (var k = 0; k < 4; k++) {
            var q = p + off[k];
            if (c[q] === opp && !this._hasLiberty(q)) {
                captured += this._removeGroup(q);
                capPoint = q;
            }
        }
        if (captured === 0 && !this._hasLiberty(p)) {
            c[p] = EMPTY;
            return false;
        }
        this.ko = -1;
        if (captured === 1) {
            var alone = true;
            var libs = 0;
            for (var k2 = 0; k2 < 4; k2++) {
                var v = c[p + off[k2]];
                if (v === me) alone = false;
                if (v === EMPTY) libs++;
            }
            if (alone && libs === 1) {
                this.ko = capPoint;
            }
        }
        this.captures[me] += captured;
        this.passes = 0;
        this.toPlay = opp;
        this.moves++;
        this.prevMove = this.lastMove;
        this.lastMove = p;
        return true;
    };

    /**
     * A point that `color` should never fill: all four neighbours are its own
     * stones (or the edge) and the diagonals do not let the opponent cut.
     */
    Board.prototype.isEye = function (p, color) {
        var c = this.cells;
        var w = this.w;
        if (c[p] !== EMPTY) return false;
        if ((c[p - 1] !== color && c[p - 1] !== EDGE) ||
            (c[p + 1] !== color && c[p + 1] !== EDGE) ||
            (c[p - w] !== color && c[p - w] !== EDGE) ||
            (c[p + w] !== color && c[p + w] !== EDGE)) {
            return false;
        }
        var opp = 3 - color;
        var bad = 0;
        var edge = 0;
        var diags = [p - w - 1, p - w + 1, p + w - 1, p + w + 1];
        for (var k = 0; k < 4; k++) {
            var v = c[diags[k]];
            if (v === opp) bad++;
            else if (v === EDGE) edge++;
        }
        return edge > 0 ? bad === 0 : bad < 2;
    };

    Board.prototype.isOver = function () {
        return this.passes >= 2;
    };

    /**
     * Area score. `dead` is an optional array of points whose stones are
     * treated as captured. Returns {black, white, score} with
     * score = black - white - komi (positive means Black wins), plus
     * `owner`, an array giving BLACK / WHITE / EMPTY for every point.
     */
    function areaScore(board, komi, dead) {
        var c = board.cells.slice();
        var w = board.w;
        var off = [-1, 1, -w, w];
        if (dead) {
            for (var d = 0; d < dead.length; d++) {
                c[dead[d]] = EMPTY;
            }
        }
        var owner = new Uint8Array(c.length);
        var seen = new Uint8Array(c.length);
        var black = 0;
        var white = 0;
        var stack = [];
        for (var p = 0; p < c.length; p++) {
            if (c[p] === BLACK) {
                black++;
                owner[p] = BLACK;
            } else if (c[p] === WHITE) {
                white++;
                owner[p] = WHITE;
            } else if (c[p] === EMPTY && !seen[p]) {
                var region = [];
                var touches = 0;
                stack.length = 0;
                stack.push(p);
                seen[p] = 1;
                while (stack.length) {
                    var q = stack.pop();
                    region.push(q);
                    for (var k = 0; k < 4; k++) {
                        var r = q + off[k];
                        var v = c[r];
                        if (v === EMPTY && !seen[r]) {
                            seen[r] = 1;
                            stack.push(r);
                        } else if (v === BLACK || v === WHITE) {
                            touches |= v;
                        }
                    }
                }
                if (touches === BLACK || touches === WHITE) {
                    for (var t = 0; t < region.length; t++) {
                        owner[region[t]] = touches;
                    }
                    if (touches === BLACK) black += region.length;
                    else white += region.length;
                }
            }
        }
        return {black: black, white: white, score: black - white - komi, owner: owner};
    }

    // Points of every stone in the group at p.
    function groupAt(board, p) {
        var c = board.cells;
        var color = c[p];
        if (color !== BLACK && color !== WHITE) return [];
        var off = [-1, 1, -board.w, board.w];
        var seen = {};
        var out = [p];
        seen[p] = true;
        for (var i = 0; i < out.length; i++) {
            for (var k = 0; k < 4; k++) {
                var r = out[i] + off[k];
                if (c[r] === color && !seen[r]) {
                    seen[r] = true;
                    out.push(r);
                }
            }
        }
        return out;
    }

    return {
        EMPTY: EMPTY,
        BLACK: BLACK,
        WHITE: WHITE,
        EDGE: EDGE,
        PASS: PASS,
        Board: Board,
        areaScore: areaScore,
        groupAt: groupAt,
    };
});
