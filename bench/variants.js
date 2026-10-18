"use strict";

// Win rate of the heuristic player for every board size and rule variant.
// Usage: node bench/variants.js [games=50]

const CatAI = require("../src/cat-ai.js");
const {randomBoard, playGame, heuristicPlayer} = require("./sim.js");

const games = Number(process.argv[2] || 50);

const sizes = [9, 11, 13, 15];
const variants = {
    "标准": {},
    "两块墙": {wallsPerTurn: 2},
    "猫打盹": {napEvery: 3},
    "边上喘气": {edgeStay: true},
};
const cats = {
    "原版猫": CatAI.classicSolver,
    "聪明猫": CatAI.smartSolver,
};

// Same starting wall density as the original 11x11 game (8 walls).
const initialWalls = (n) => Math.round((8 * n * n) / 121);

console.log(`启发式玩家的胜率，每格 ${games} 局（种子 1..${games}）\n`);
for (const [catName, cat] of Object.entries(cats)) {
    const header = ["棋盘", ...Object.keys(variants)];
    console.log(`${catName}\n| ${header.join(" | ")} |\n|${header.map(() => "---").join("|")}|`);
    for (const n of sizes) {
        const row = [`${n}×${n}`];
        for (const rules of Object.values(variants)) {
            let wins = 0;
            for (let seed = 1; seed <= games; seed++) {
                const board = randomBoard(seed, n, n, initialWalls(n));
                if (playGame(board, cat, heuristicPlayer, rules).winner === "player") wins++;
            }
            row.push(`${Math.round((wins / games) * 100)}%`);
        }
        console.log(`| ${row.join(" | ")} |`);
    }
    console.log();
}
