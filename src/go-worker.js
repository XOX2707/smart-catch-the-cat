/* Runs the cat's Go AI off the main thread so the page stays responsive. */
importScripts("go-engine.js", "go-ai.js");

self.onmessage = function (e) {
    var msg = e.data;
    var board = GoEngine.Board.fromJSON(msg.board);
    if (msg.type === "move") {
        var r = GoAI.chooseMove(board, msg.opts);
        self.postMessage({
            id: msg.id,
            type: "move",
            move: r.move,
            resign: r.resign,
            winrate: r.winrate,
            playouts: r.playouts,
        });
    } else if (msg.type === "dead") {
        self.postMessage({id: msg.id, type: "dead", dead: GoAI.estimateDead(board, msg.opts)});
    }
};
