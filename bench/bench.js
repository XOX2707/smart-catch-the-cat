"use strict";

// Pits both cats against both computer players on the same random boards.
// Usage: node bench/bench.js [games=50] [searchBudget=1500] [classic|smart]
// The optional last argument runs only that cat.

const CatAI = require("../src/cat-ai.js");
const {randomBoard, playGame, heuristicPlayer, searchPlayer} = require("./sim.js");

const games = Number(process.argv[2] || 50);
const budget = Number(process.argv[3] || 1500);
const only = process.argv[4];

const allCats = {
    classic: ["原版猫 classic", CatAI.classicSolver],
    smart: ["聪明猫 smart", CatAI.smartSolver],
};
const cats = Object.fromEntries(
    Object.entries(allCats)
        .filter(([key]) => !only || key === only)
        .map(([, value]) => value)
);
const players = {
    "启发式玩家": heuristicPlayer,
    [`搜索玩家(预算 ${budget})`]: searchPlayer({budget}),
};

console.log(`${games} 局，棋盘 11x11，开局 8 块随机墙，种子 1..${games}\n`);
for (const [playerName, player] of Object.entries(players)) {
    for (const [catName, cat] of Object.entries(cats)) {
        const started = Date.now();
        let wins = 0;
        let moves = 0;
        for (let seed = 1; seed <= games; seed++) {
            const result = playGame(randomBoard(seed), cat, player);
            if (result.winner === "player") {
                wins++;
                moves += result.moves;
            }
        }
        const rate = ((wins / games) * 100).toFixed(1);
        const avg = wins ? (moves / wins).toFixed(1) : "-";
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        console.log(`${playerName} vs ${catName}: 玩家胜率 ${rate}% (${wins}/${games})，赢的局平均 ${avg} 步，用时 ${secs}s`);
    }
}
