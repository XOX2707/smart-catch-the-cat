"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const G = require("../src/go-engine.js");
const AI = require("../src/go-ai.js");

// Plays a list of [x, y] moves (null = pass) alternately from Black.
function setup(n, moves) {
    const b = new G.Board(n);
    for (const m of moves) {
        const p = m === null ? G.PASS : b.point(m[0], m[1]);
        assert.ok(b.play(p), `move ${JSON.stringify(m)} should be legal`);
    }
    return b;
}

test("capturing a single stone removes it and counts it", () => {
    // White (1,1) surrounded by Black.
    const b = setup(5, [[1, 0], [1, 1], [0, 1], [4, 4], [2, 1], [4, 3], [1, 2]]);
    assert.equal(b.get(1, 1), G.EMPTY);
    assert.equal(b.captures[G.BLACK], 1);
});

test("corner and edge captures work", () => {
    const b = setup(5, [[1, 0], [0, 0], [0, 1]]);
    assert.equal(b.get(0, 0), G.EMPTY);
    assert.equal(b.captures[G.BLACK], 1);
});

test("suicide is illegal and leaves the board unchanged", () => {
    // Black owns (0,1) and (1,0); White may not play the corner.
    const b = setup(5, [[0, 1], [4, 4], [1, 0]]);
    const before = b.cells.slice();
    assert.equal(b.isLegal(b.point(0, 0)), false);
    assert.equal(b.play(b.point(0, 0)), false);
    assert.deepEqual(b.cells, before);
    assert.equal(b.toPlay, G.WHITE);
});

test("a move that captures is not suicide", () => {
    // Black (1,0) and (0,1) each have (0,0) as their last liberty. White
    // playing the corner has no liberties itself but captures both.
    const b = setup(5, [[1, 0], [2, 0], [0, 1], [1, 1], [4, 4], [0, 2], [4, 3]]);
    assert.equal(b.toPlay, G.WHITE);
    assert.equal(b.isLegal(b.point(0, 0)), true);
    b.play(b.point(0, 0));
    assert.equal(b.get(1, 0), G.EMPTY);
    assert.equal(b.get(0, 1), G.EMPTY);
});

test("simple ko: immediate recapture is illegal, allowed after a move elsewhere", () => {
    // Classic ko shape around (1,1)/(2,1).
    const b = setup(5, [
        [1, 0], [2, 0],
        [0, 1], [3, 1],
        [1, 2], [2, 2],
        [4, 4], [1, 1], // White plays into the ko spot
        [2, 1],         // Black captures White (1,1)
    ]);
    assert.equal(b.get(1, 1), G.EMPTY);
    assert.equal(b.ko, b.point(1, 1));
    assert.equal(b.isLegal(b.point(1, 1)), false);
    b.play(b.point(4, 0)); // White ko threat elsewhere
    b.play(b.point(0, 4)); // Black answers
    assert.equal(b.isLegal(b.point(1, 1)), true);
});

test("two passes end the game", () => {
    const b = setup(5, [[2, 2], null, null]);
    assert.ok(b.isOver());
});

test("area scoring counts stones and surrounded points, minus komi", () => {
    // Black wall on column 1, White wall on column 3 of a 5x5 board.
    const b = setup(5, [
        [1, 0], [3, 0], [1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3], [1, 4], [3, 4],
    ]);
    const r = G.areaScore(b, 0.5);
    // Black: column 0 (5) + column 1 (5). White: columns 3 and 4 (10). Column 2 touches both.
    assert.equal(r.black, 10);
    assert.equal(r.white, 10);
    assert.equal(r.score, -0.5);
});

test("dead stones are removed before counting", () => {
    const b = setup(5, [
        [1, 0], [3, 0], [1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3], [1, 4], [3, 4],
        [4, 2], // Black stone inside White's area
    ]);
    const alive = G.areaScore(b, 0.5);
    const dead = G.areaScore(b, 0.5, [b.point(4, 2)]);
    assert.ok(dead.white > alive.white);
    assert.equal(dead.white, 10);
});

test("toJSON / fromJSON round trip keeps the position", () => {
    const b = setup(9, [[2, 2], [6, 6], [2, 6]]);
    const c = G.Board.fromJSON(JSON.parse(JSON.stringify(b.toJSON())));
    assert.deepEqual(c.cells, b.cells);
    assert.equal(c.toPlay, b.toPlay);
    assert.equal(c.lastMove, b.lastMove);
});

test("AI captures a stone left in atari", () => {
    const b = setup(9, [[4, 3], [4, 4], [3, 4], [2, 6], [5, 4], [6, 6]]);
    const r = AI.chooseMove(b, {maxPlayouts: 3000, timeMs: 10000, seed: 7});
    assert.deepEqual(b.xy(r.move), [4, 5]);
});

test("AI saves its own stone from atari", () => {
    const b = setup(9, [[4, 3], [4, 4], [3, 4], [2, 6], [5, 4]]);
    const r = AI.chooseMove(b, {maxPlayouts: 3000, timeMs: 10000, seed: 7});
    assert.deepEqual(b.xy(r.move), [4, 5]);
});

test("AI never returns an illegal move and finishes a game against a random player", () => {
    let seed = 99;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const b = new G.Board(9);
    let turns = 0;
    while (!b.isOver() && turns < 300) {
        let move;
        if (b.toPlay === G.WHITE) {
            const r = AI.chooseMove(b, {maxPlayouts: 300, timeMs: 10000, seed: turns});
            if (r.resign) break;
            move = r.move;
        } else {
            const moves = AI.candidateMoves(b);
            move = moves.length ? moves[Math.floor(random() * moves.length)] : G.PASS;
        }
        assert.ok(b.isLegal(move), "legal move");
        b.play(move);
        turns++;
    }
    assert.ok(turns < 300, "game ended");
    const dead = AI.estimateDead(b, {playouts: 200});
    const score = G.areaScore(b, 7.5, dead).score;
    assert.ok(score < 0, `White (AI) should beat a random player, score ${score}`);
});
