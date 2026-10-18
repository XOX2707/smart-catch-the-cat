"use strict";

// Headless copy of the game rules plus two computer players, used by the
// benchmark and the tests.

const CatAI = require("../src/cat-ai.js");

const W = 11;
const H = 11;
const INITIAL_WALLS = 8;

// Small seeded RNG (mulberry32) so every run uses the same boards.
function rng(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Same algorithm as MainScene.randomWall: partial Fisher-Yates over all cells
// except the cat's.
function randomBoard(seed, w = W, h = H, count = INITIAL_WALLS) {
    const rand = rng(seed);
    const walls = Array.from({length: w}, () => Array(h).fill(false));
    const ci = Math.floor(w / 2);
    const cj = Math.floor(h / 2);
    const cells = [];
    for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
            if (!(i === ci && j === cj)) cells.push(j * w + i);
        }
    }
    for (let n = 0; n < cells.length && n < count; n++) {
        const e = n + Math.floor(rand() * (cells.length - n));
        [cells[n], cells[e]] = [cells[e], cells[n]];
        walls[cells[n] % w][Math.floor(cells[n] / w)] = true;
    }
    return {walls, ci, cj};
}

const isEdge = (w, h, i, j) => i <= 0 || i >= w - 1 || j <= 0 || j >= h - 1;
const inside = (w, h, p) => p.i >= 0 && p.i < w && p.j >= 0 && p.j < h;

function isCaught(walls, ci, cj) {
    const w = walls.length;
    const h = walls[0].length;
    return !CatAI.getNeighbours(ci, cj).some((p) => inside(w, h, p) && !walls[p.i][p.j]);
}

/**
 * Plays one game the way MainScene.playerClick does.
 * Returns {winner: "player" | "cat", reason, moves}.
 */
function playGame(board, catSolver, player) {
    const walls = board.walls.map((col) => col.slice());
    const w = walls.length;
    const h = walls[0].length;
    let ci = board.ci;
    let cj = board.cj;
    for (let moves = 1; moves <= w * h; moves++) {
        const [wi, wj] = player(walls, ci, cj, catSolver);
        if (walls[wi][wj] || (wi === ci && wj === cj)) {
            throw new Error(`illegal player move (${wi}, ${wj})`);
        }
        walls[wi][wj] = true;
        if (isCaught(walls, ci, cj)) return {winner: "player", reason: "caught", moves};
        const dir = catSolver(walls, ci, cj);
        if (dir < 0 || dir > 5) return {winner: "player", reason: "gave up", moves};
        const next = CatAI.getNeighbours(ci, cj)[dir];
        if (!inside(w, h, next) || walls[next.i][next.j]) {
            return {winner: "player", reason: "walked into a wall", moves};
        }
        ci = next.i;
        cj = next.j;
        if (isEdge(w, h, ci, cj)) return {winner: "cat", reason: "escaped", moves};
    }
    throw new Error("game did not end");
}

function freeCells(walls, ci, cj) {
    const out = [];
    for (let i = 0; i < walls.length; i++) {
        for (let j = 0; j < walls[0].length; j++) {
            if (!walls[i][j] && !(i === ci && j === cj)) out.push([i, j]);
        }
    }
    return out;
}

/**
 * Player that does not know the cat's code: places the wall that leaves the
 * cat with the worst best next step, judged by two-distance, then plain
 * distance.
 */
function heuristicPlayer(walls, ci, cj) {
    const w = walls.length;
    const h = walls[0].length;
    const g = CatAI.geometry(w, h);
    const nbs = CatAI.getNeighbours(ci, cj).filter((p) => inside(w, h, p));
    const exits = nbs.filter((p) => !walls[p.i][p.j] && isEdge(w, h, p.i, p.j));
    if (exits.length > 0) return [exits[0].i, exits[0].j];

    let best = null;
    let bestKey = null;
    for (const [i, j] of freeCells(walls, ci, cj)) {
        walls[i][j] = true;
        const flat = CatAI.toFlat(walls, g);
        const two = CatAI.twoDistance(g, flat);
        const one = CatAI.edgeDistance(g, flat);
        let minTwo = CatAI.INF;
        let minOne = CatAI.INF;
        let free = 0;
        for (const p of nbs) {
            if (walls[p.i][p.j]) continue;
            free++;
            const k = p.i * h + p.j;
            minTwo = Math.min(minTwo, two[k]);
            minOne = Math.min(minOne, one[k]);
        }
        walls[i][j] = false;
        const key = free === 0 ? [Infinity, Infinity, 0] : [minTwo, minOne, -free];
        if (bestKey === null || compareKeys(key, bestKey) > 0) {
            bestKey = key;
            best = [i, j];
        }
    }
    return best;
}

function compareKeys(a, b) {
    for (let x = 0; x < a.length; x++) {
        if (a[x] !== b[x]) return a[x] > b[x] ? 1 : -1;
    }
    return 0;
}

/**
 * Player that knows the cat's exact code and searches for a forced win with
 * iterative deepening (the method used to beat the original game). Walls are
 * only tried within `radius` steps of the cat. `budget` caps the number of cat
 * solver calls per move; when no forced win is found in time it falls back
 * to heuristicPlayer.
 */
function searchPlayer({budget = 3000, radius = 2, maxDepth = 12} = {}) {
    return function (walls, ci, cj, catSolver) {
        const w = walls.length;
        const h = walls[0].length;
        const bd = walls.map((col) => col.slice());
        let calls = 0;

        function search(ci, cj, depth) {
            const nbs = CatAI.getNeighbours(ci, cj);
            const free = (p) => inside(w, h, p) && !bd[p.i][p.j];
            const exits = nbs.filter((p) => free(p) && isEdge(w, h, p.i, p.j));
            if (exits.length >= 2) return null;
            let cands;
            if (exits.length === 1) {
                cands = [[exits[0].i, exits[0].j]];
            } else {
                const dist = reach(bd, ci, cj);
                cands = freeCells(bd, ci, cj)
                    .filter(([i, j]) => dist[i][j] <= radius)
                    .sort((a, b) => dist[a[0]][a[1]] - dist[b[0]][b[1]]);
            }
            for (const [i, j] of cands) {
                if (calls >= budget) throw new Error("budget");
                bd[i][j] = true;
                let ok = false;
                if (!nbs.some(free)) {
                    ok = true;
                } else {
                    calls++;
                    const dir = catSolver(bd, ci, cj);
                    if (dir < 0 || dir > 5 || !free(nbs[dir])) ok = true;
                    else {
                        const n = nbs[dir];
                        ok = !isEdge(w, h, n.i, n.j) && depth > 1 && search(n.i, n.j, depth - 1) !== null;
                    }
                }
                bd[i][j] = false;
                if (ok) return [i, j];
            }
            return null;
        }

        try {
            for (let d = 1; d <= maxDepth; d++) {
                const res = search(ci, cj, d);
                if (res) return res;
            }
        } catch (e) {
            if (e.message !== "budget") throw e;
        }
        return heuristicPlayer(walls, ci, cj);
    };
}

// Steps from the cat to every free cell.
function reach(walls, ci, cj) {
    const w = walls.length;
    const h = walls[0].length;
    const dist = Array.from({length: w}, () => Array(h).fill(Infinity));
    dist[ci][cj] = 0;
    const queue = [[ci, cj]];
    while (queue.length) {
        const [i, j] = queue.shift();
        for (const p of CatAI.getNeighbours(i, j)) {
            if (!inside(w, h, p) || walls[p.i][p.j] || dist[p.i][p.j] !== Infinity) continue;
            dist[p.i][p.j] = dist[i][j] + 1;
            queue.push([p.i, p.j]);
        }
    }
    return dist;
}

module.exports = {W, H, rng, randomBoard, playGame, isCaught, heuristicPlayer, searchPlayer};
