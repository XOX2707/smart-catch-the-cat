"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CatAI = require("../src/cat-ai.js");
const {randomBoard, playGame, heuristicPlayer} = require("../bench/sim.js");

function emptyBoard(w = 11, h = 11) {
    return Array.from({length: w}, () => Array(h).fill(false));
}

function decode(hex, w = 11, h = 11) {
    const bits = [...hex].map((c) => parseInt(c, 16).toString(2).padStart(4, "0")).join("");
    const walls = emptyBoard(w, h);
    for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
            walls[i][j] = bits[i * h + j] === "1";
        }
    }
    return walls;
}

test("classicSolver matches the cat on the live site", () => {
    const text = fs.readFileSync(path.join(__dirname, "classic-cases.txt"), "utf8");
    const cases = text
        .split("\n")
        .filter((line) => line && !line.startsWith("#"))
        .join(" ")
        .split(/\s+/)
        .filter(Boolean);
    assert.ok(cases.length >= 100);
    for (const c of cases) {
        const [hex, pos, dir] = c.split(":");
        const ci = Number(pos[0]);
        const cj = Number(pos[1]);
        assert.equal(CatAI.classicSolver(decode(hex), ci, cj), Number(dir), c);
    }
});

test("twoDistance: a cell next to two free edge cells is 1, next to one is more", () => {
    const g = CatAI.geometry(11, 11);
    const walls = emptyBoard();
    const two = CatAI.twoDistance(g, CatAI.toFlat(walls, g));
    // (1, 1) touches several edge cells.
    assert.equal(two[1 * 11 + 1], 1);
    // (1, 5) is on an odd row and touches only one edge cell, (0, 5): the
    // player can block it, so the cat needs one more step.
    assert.equal(CatAI.getNeighbours(1, 5).filter((p) => p.i === 0).length, 1);
    assert.equal(two[1 * 11 + 5], 2);
    // Wall that edge cell and the neighbours' values go up too.
    walls[0][5] = true;
    const two2 = CatAI.twoDistance(g, CatAI.toFlat(walls, g));
    assert.ok(two2[1 * 11 + 5] >= 2);
});

test("smartSolver steps straight onto a free edge cell", () => {
    const walls = emptyBoard();
    const dir = CatAI.smartSolver(walls, 1, 5);
    const next = CatAI.getNeighbours(1, 5)[dir];
    assert.equal(next.i, 0);
});

test("smartSolver never walks into a wall and only gives up when fully surrounded", () => {
    for (let seed = 1; seed <= 30; seed++) {
        const {walls} = randomBoard(seed, 11, 11, 40);
        for (let i = 1; i < 10; i++) {
            for (let j = 1; j < 10; j++) {
                if (walls[i][j]) continue;
                const dir = CatAI.smartSolver(walls, i, j);
                const free = CatAI.getNeighbours(i, j).filter((p) => !walls[p.i][p.j]);
                if (free.length === 0) {
                    assert.equal(dir, -1);
                } else {
                    assert.ok(dir >= 0 && dir <= 5);
                    const p = CatAI.getNeighbours(i, j)[dir];
                    assert.equal(walls[p.i][p.j], false);
                }
            }
        }
    }
});

test("smartSolver keeps moving inside an enclosure instead of giving up", () => {
    const walls = emptyBoard();
    // Ring of walls around (5, 5) at distance 2 leaves a 7-cell pocket.
    const inner = new Set(["5,5", ...CatAI.getNeighbours(5, 5).map((p) => `${p.i},${p.j}`)]);
    for (const key of inner) {
        const [i, j] = key.split(",").map(Number);
        for (const p of CatAI.getNeighbours(i, j)) {
            if (!inner.has(`${p.i},${p.j}`)) walls[p.i][p.j] = true;
        }
    }
    assert.equal(CatAI.classicSolver(walls, 5, 5), -1);
    const dir = CatAI.smartSolver(walls, 5, 5);
    assert.ok(dir >= 0 && dir <= 5);
});

test("wallsBeforeNextMove counts double walls and naps", () => {
    assert.equal(CatAI.wallsBeforeNextMove({}, 1), 1);
    assert.equal(CatAI.wallsBeforeNextMove({wallsPerTurn: 2}, 1), 2);
    // napEvery 3: turn 3 is a nap, so after turn 2 the player gets two turns.
    assert.equal(CatAI.wallsBeforeNextMove({napEvery: 3}, 1), 1);
    assert.equal(CatAI.wallsBeforeNextMove({napEvery: 3}, 2), 2);
    assert.equal(CatAI.wallsBeforeNextMove({wallsPerTurn: 2, napEvery: 3}, 2), 4);
});

test("kDistance with k = 2 matches twoDistance", () => {
    const g = CatAI.geometry(11, 11);
    const {walls} = randomBoard(5);
    const flat = CatAI.toFlat(walls, g);
    assert.deepEqual(CatAI.kDistance(g, flat, 2, null), CatAI.twoDistance(g, flat));
});

test("with edgeStay the smart cat avoids an edge cell it would be walled in on", () => {
    const walls = emptyBoard();
    // (0, 5) is an edge cell; leave it only the cat's own cell as a free neighbour.
    for (const p of CatAI.getNeighbours(0, 5)) {
        if (p.i >= 0 && !(p.i === 1 && p.j === 5)) walls[p.i][p.j] = true;
    }
    const dir = CatAI.smartSolver(walls, 1, 5, {blocks: 1, edgeStay: true});
    const next = CatAI.getNeighbours(1, 5)[dir];
    assert.ok(!(next.i === 0 && next.j === 5), "should not step onto the trap");
    // Without edgeStay that edge cell is an instant escape.
    const plain = CatAI.getNeighbours(1, 5)[CatAI.smartSolver(walls, 1, 5)];
    assert.equal(plain.i, 0);
});

test("variant games run to the end and the extra walls help the player", () => {
    let normal = 0;
    let double = 0;
    for (let seed = 1; seed <= 15; seed++) {
        if (playGame(randomBoard(seed), CatAI.smartSolver, heuristicPlayer).winner === "player") normal++;
        if (playGame(randomBoard(seed), CatAI.smartSolver, heuristicPlayer, {wallsPerTurn: 2}).winner === "player") double++;
        const r = playGame(randomBoard(seed, 13, 13, 11), CatAI.smartSolver, heuristicPlayer, {napEvery: 3, edgeStay: true});
        assert.ok(r.winner === "player" || r.winner === "cat");
    }
    assert.ok(double > normal, `double ${double} vs normal ${normal}`);
});

test("smart cat escapes the heuristic player more often than the classic cat", () => {
    let classic = 0;
    let smart = 0;
    for (let seed = 1; seed <= 20; seed++) {
        if (playGame(randomBoard(seed), CatAI.classicSolver, heuristicPlayer).winner === "cat") classic++;
        if (playGame(randomBoard(seed), CatAI.smartSolver, heuristicPlayer).winner === "cat") smart++;
    }
    assert.ok(smart > classic, `smart ${smart} vs classic ${classic}`);
});
