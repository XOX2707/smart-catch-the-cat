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
            if (this.game.skin) {
                applySkin(this, this.game.skin);
            }
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
                this.cat.caught();
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
                this.cat.caught();
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

    // ---------- pixel-art skins ----------

    // Values from the upstream sprite data (data.ts): which point of each
    // texture sits on the cat's dot, and the animations built on them.
    var ORIGINS = {
        left: {x: 0.75, y: 0.75},
        top_left: {x: 0.63, y: 0.83},
        bottom_left: {x: 0.65, y: 0.5},
    };
    var FRAME_RATE = 15;

    /**
     * Replaces the cat's 15 textures (3 directions x 5 frames) with a pixel
     * skin (see src/skins/gege.js), plus one "caught" texture per direction.
     * Like the originals, frames 2..5 move the cat a quarter step each
     * towards the next dot, so the walk ends exactly where the next stop
     * frame begins.
     */
    function applySkin(scene, skin) {
        var r = scene.r;
        var px = Math.max(1, Math.round((2 * r) / 20));
        var steps = {
            left: [-2 * r, 0],
            top_left: [-r, -r * Math.sqrt(3)],
            bottom_left: [-r, r * Math.sqrt(3)],
        };
        Object.keys(ORIGINS).forEach(function (name) {
            var dir = skin.directions[name];
            var origin = ORIGINS[name];
            var step = steps[name];
            var sw = dir.frames[0][0].length * px;
            var sh = Math.max(dir.frames[0].length, dir.caught.length) * px;
            var ax = (dir.anchor[0] + 0.5) * px;
            var ay = (dir.anchor[1] + 0.5) * px;
            // Box around the origin that holds the sprite at the start and
            // at the end of a step.
            var minX = Math.min(0, step[0]) - ax;
            var maxX = Math.max(0, step[0]) - ax + sw;
            var minY = Math.min(0, step[1]) - ay - px * 2;
            var maxY = Math.max(0, step[1]) - ay + sh;
            var width = Math.ceil(Math.max(-minX / origin.x, maxX / (1 - origin.x))) + 2;
            var height = Math.ceil(Math.max(-minY / origin.y, maxY / (1 - origin.y))) + 2;
            var ox = origin.x * width;
            var oy = origin.y * height;

            function paint(key, rows, t) {
                if (scene.textures.exists(key)) {
                    scene.textures.remove(key);
                }
                var tex = scene.textures.createCanvas(key, width, height);
                var ctx = tex.getContext();
                // Feet line up with the anchor; taller sprites grow upwards.
                var left = Math.round(ox + step[0] * t - ax);
                var top = Math.round(oy + step[1] * t - ay - (rows.length - dir.frames[0].length) * px);
                for (var y = 0; y < rows.length; y++) {
                    for (var x = 0; x < rows[y].length; x++) {
                        var color = skin.palette[rows[y][x]];
                        if (!color) continue;
                        ctx.fillStyle = color;
                        ctx.fillRect(left + x * px, top + y * px, px, px);
                    }
                }
                tex.refresh();
            }

            for (var k = 1; k <= 5; k++) {
                paint(name + "_" + k, dir.frames[k - 1], (k - 1) / 4);
            }
            paint("skin_caught_" + name, dir.caught, 0);

            // The animations kept references to the old textures' frames.
            [name + "_step", name + "_run"].forEach(function (anim) {
                if (scene.anims.get(anim)) {
                    scene.anims.remove(anim);
                }
            });
            scene.anims.create({
                key: name + "_step",
                frames: [1, 2, 3, 4, 5].map(function (k) { return {key: name + "_" + k}; }),
                frameRate: FRAME_RATE,
                repeat: 0,
            });
            scene.anims.create({
                key: name + "_run",
                frames: [2, 3, 4, 5].map(function (k) { return {key: name + "_" + k}; }),
                frameRate: FRAME_RATE,
                repeat: 3,
            });
        });
        scene.cat.resetTextureToStop();
    }

    function patchCat(proto) {
        if (proto.__variantsPatched) return;
        proto.__variantsPatched = true;
        var originalCaught = proto.caught;
        proto.caught = function () {
            if (this.scene.game.skin) {
                var name = this.direction === 1 || this.direction === 2 ? "top_left"
                    : this.direction === 4 || this.direction === 5 ? "bottom_left" : "left";
                this.anims.stop();
                this.setTexture("skin_caught_" + name);
                return;
            }
            return originalCaught.call(this);
        };
        var originalCheckState = proto.checkState;
        proto.checkState = function () {
            var scene = this.scene;
            var rules = scene.game.rules || {};
            if (scene.state !== PLAYING) {
                // The escape run animation calls this on every repeat; upstream
                // would set "lose" again and overwrite the status message.
                return;
            }
            if (!rules.edgeStay || !this.isEscaped()) {
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
        game.skin = opts.skin || null;
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
