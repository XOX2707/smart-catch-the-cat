/*!
 * Board sizes and rule variants for ganlvtech/phaser-catch-the-cat.
 *
 * The upstream game has no hooks for different rules, so this patches its
 * MainScene and Cat prototypes (once) and reads the rules from game.rules:
 *   wallsPerTurn: the player places this many walls before the cat moves
 *   napEvery:     the cat skips every n-th of its turns
 *   edgeStay:     reaching the edge is not enough; the cat has to wait there
 *                 for one turn, and is caught if it gets walled in meanwhile
 *
 * Needs CatchTheCatGame (vendor/catch-the-cat.js) and CatAI (src/cat-ai.js).
 */
(function (root) {
    "use strict";

    var PLAYING = "playing";
    var WIN = "win";
    var LOSE = "lose";

    function freshState() {
        return {history: [], placed: 0, catTurn: 0, onEdge: false};
    }

    function patchScene(proto) {
        if (proto.__variantsPatched) return;
        proto.__variantsPatched = true;

        var originalReset = proto.reset;
        proto.reset = function () {
            this.variant = freshState();
            originalReset.call(this);
        };

        var originalCreate = proto.create;
        proto.create = function () {
            originalCreate.call(this);
            patchCat(Object.getPrototypeOf(this.cat));
        };

        // Same checks and messages as upstream, plus the variant rules.
        proto.playerClick = function (i, j) {
            var rules = this.game.rules || {};
            var v = this.variant || (this.variant = freshState());
            if (this.cat.anims.isPlaying) {
                this.cat.anims.stop();
            }
            if (this.state !== PLAYING) {
                this.setStatusText("游戏已经结束，重新开局");
                this.reset();
                return false;
            }
            var block = this.getBlock(i, j);
            if (!block) {
                return false;
            }
            if (block.isWall) {
                this.setStatusText("这里已经是墙了");
                return false;
            }
            if (this.cat.i === i && this.cat.j === j) {
                this.setStatusText("不能把墙放在猫身上");
                return false;
            }
            v.history.push({
                wall: {i: i, j: j},
                cat: {i: this.cat.i, j: this.cat.j},
                placed: v.placed,
                catTurn: v.catTurn,
                onEdge: v.onEdge,
            });
            block.isWall = true;
            if (this.cat.isCaught()) {
                this.state = WIN;
                return false;
            }

            var perTurn = rules.wallsPerTurn || 1;
            v.placed++;
            if (v.placed < perTurn) {
                this.setStatusText("再放 " + (perTurn - v.placed) + " 块墙，猫才会动");
                return true;
            }
            v.placed = 0;
            v.catTurn++;
            if (rules.napEvery && v.catTurn % rules.napEvery === 0) {
                this.setStatusText("猫在打盹 zZ，这回合它没动");
                return true;
            }
            if (v.onEdge) {
                this.state = LOSE;
                this.setStatusText("猫在边上喘过气，溜走了，你输了");
                this.cat.escape();
                return true;
            }
            this.setStatusText("您点击了 (" + i + ", " + j + ")");
            if (!this.cat.step()) {
                this.state = WIN;
                this.setStatusText("猫认输，你赢了！");
            }
            return true;
        };

        proto.undo = function () {
            var v = this.variant || (this.variant = freshState());
            if (!v.history.length) {
                this.setStatusText("无路可退！！！");
                return;
            }
            if (this.state !== PLAYING) {
                this.setStatusText("游戏已经结束，重新开局");
                this.reset();
                return;
            }
            var s = v.history.pop();
            this.cat.undo(s.cat.i, s.cat.j);
            this.getBlock(s.wall.i, s.wall.j).isWall = false;
            v.placed = s.placed;
            v.catTurn = s.catTurn;
            v.onEdge = s.onEdge;
            this.setStatusText("悔了一步");
        };
    }

    function patchCat(proto) {
        if (proto.__variantsPatched) return;
        proto.__variantsPatched = true;
        var originalCheckState = proto.checkState;
        proto.checkState = function () {
            var scene = this.scene;
            var rules = scene.game.rules || {};
            if (!rules.edgeStay || scene.state !== PLAYING || !this.isEscaped()) {
                return originalCheckState.call(this);
            }
            if (this.isCaught()) {
                this.caught();
                this.emit("win");
                return;
            }
            scene.variant.onEdge = true;
            scene.setStatusText("猫跑到边上了！它要喘口气才能逃，最后一次机会");
        };
    }

    /**
     * Creates (or re-creates) the game.
     * opts: {parent, size, rules, solver(blocks, i, j, catRules), credit}
     */
    function createGame(opts) {
        if (root.game && root.game.destroy) {
            // Phaser removes the old canvas on its next frame, which never
            // comes while the tab is hidden, so hide it right away.
            if (root.game.canvas) {
                root.game.canvas.style.display = "none";
            }
            root.game.destroy(true);
        }
        var size = opts.size || 11;
        // Keep the canvas about as wide as the original 11x11 board.
        var r = Math.round(570 / (6.5 + 2 * size));
        var game = new root.CatchTheCatGame({
            w: size,
            h: size,
            r: r,
            initialWallCount: Math.round((8 * size * size) / 121),
            backgroundColor: 0xffffff,
            parent: opts.parent,
            statusBarAlign: "center",
            credit: opts.credit || "github.com/ganlvtech",
        });
        patchScene(Object.getPrototypeOf(game.mainScene));
        game.rules = opts.rules || {};
        var solver = function (blocks, i, j) {
            var scene = game.mainScene;
            var turn = scene.variant ? scene.variant.catTurn : 0;
            return opts.solver(blocks, i, j, {
                blocks: root.CatAI.wallsBeforeNextMove(game.rules, turn),
                edgeStay: !!game.rules.edgeStay,
            });
        };
        // The solver setter also writes to the cat sprite, which does not
        // exist until the scene is created; the scene reads game.solver then.
        try {
            game.solver = solver;
        } catch (e) {
        }
        root.game = game;
        return game;
    }

    root.CatVariants = {createGame: createGame};
})(typeof self !== "undefined" ? self : this);
