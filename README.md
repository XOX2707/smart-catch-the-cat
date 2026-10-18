# 聪明的神经猫

给 [ganlvtech/phaser-catch-the-cat](https://github.com/ganlvtech/phaser-catch-the-cat)（围住神经猫）换一只更难抓的猫。

游戏本体、画面和规则都没改，只是通过原作留的接口 `window.game.solver` 换掉了猫的 AI。

## 怎么玩

用浏览器打开 `index.html` 就能玩，页面上可以在「聪明猫」和「原版猫」之间切换，也可以直接用网址参数 `?cat=classic` 或 `?cat=smart`。

勾选「偷看猫的打算」会显示：按现在的棋盘，猫下一步想往哪个方向走。你放下的墙可能让它改主意，所以这只是它此刻的打算。

开局时猫的脸总是朝左下，这只是原作写死的默认姿势（`catDefaultDirection: 5`），和它第一步往哪走没有关系。

浏览器直接打开本地文件时如果棋盘不显示，在本目录起一个静态服务器再访问：

```bash
python -m http.server 8137
```

然后打开 http://localhost:8137/

## 原版猫有什么弱点

原作线上版本的猫（移植在 `src/cat-ai.js` 的 `classicSolver`）：

1. 每一步只沿最短路线往最近的边缘走，几条路一样短时挑「最短路线条数最多」的方向。
2. 完全不考虑玩家下一步会堵哪里。
3. 一旦找不到通往边缘的路，立刻认输，哪怕它还能在圈里走很多步。

所以只要玩家知道它的规则，就能提前算好，第一步就能找到必胜下法。

## 聪明猫怎么想

`smartSolver` 做了三件事：

1. **两距离（two-distance）**：一个格子的「逃跑步数」不是到边缘的最短距离，而是「第二近」的那个邻格的步数加一。因为玩家每回合都会先堵掉猫最好的那一步，猫要有两条路可选才算真的有路。这和围棋里「两只眼才是活棋」是一个道理。
2. **往前看一步**：猫每走一步之前，把玩家下一步所有可能放墙的位置都试一遍，按最坏情况给每个方向打分，选最坏情况下也最容易逃的方向。这样一块墙同时切断好几条路的情况也能看出来。
3. **不认输**：真被圈住了也不放弃，会在圈里挑空间最大的地方走，玩家必须把它六面全堵上才算赢。如果玩家已经能必胜，猫会退回用普通最短距离继续跑，等玩家下错。

一步大约 1.5 毫秒（Node 24，11×11 棋盘）。

## 实测对比

`bench/` 里有一份无界面的游戏规则和两个电脑玩家，用同样的 50 个随机开局（种子 1 到 50，规则同原作：11×11，开局 8 块随机墙）对比两只猫：

- **启发式玩家**：不知道猫的代码，每步放「让猫下一步最难逃」的墙。
- **搜索玩家**：知道猫的代码，在猫附近两格内逐步加深搜索必胜下法，每步最多调用 1500 次猫的 AI，找不到就退回启发式。

```bash
npm run bench
```

2026-10-18 的结果（`node bench/bench.js 50 1500`）：

| 玩家 | 对原版猫 | 对聪明猫 |
|---|---|---|
| 启发式玩家 | 赢 29/50（58%） | 赢 5/50（10%） |
| 搜索玩家（每步预算 1500） | 赢 29/50（58%） | 赢 5/50（10%） |

玩家赢下来的局，对原版猫平均 15 到 16 步，对聪明猫要 25 到 27 步。

两个玩家胜率一样，是因为每步 1500 次的预算太小，搜索玩家大多数时候没搜到必胜下法，退回了启发式下法。

补充：把搜索玩家的预算加到每步 200000 次，它对原版猫 50 局全胜（`node bench/bench.js 50 200000 classic`，约 100 秒）。聪明猫一步的计算量是原版的几百倍，同样的预算要跑几个小时，所以没有测，聪明猫在这个强度下的胜率目前不知道。

## 测试

```bash
npm test
```

只用 Node 自带的测试工具，不需要装依赖。其中一项测试用从线上原版游戏里录下来的 160 个随机局面（`test/classic-cases.txt`），核对 `classicSolver` 和线上的猫走法完全一致。

## 在自己的页面里用

```html
<script src="vendor/phaser.min.js"></script>
<script src="vendor/catch-the-cat.js"></script>
<script src="src/cat-ai.js"></script>
<div id="catch-the-cat"></div>
<script>
    window.game = new CatchTheCatGame({w: 11, h: 11, r: 20, initialWallCount: 8, parent: "catch-the-cat"});
    try { window.game.solver = CatAI.smartSolver; } catch (e) {}
</script>
```

`try` 是因为原作的 `solver` setter 在场景创建前会顺手去设置还不存在的猫对象而报错，但值已经存下了，场景创建时会读到它。

## 文件

| 路径 | 说明 |
|---|---|
| `index.html` | 游戏页面，可切换两只猫 |
| `src/cat-ai.js` | 聪明猫 `smartSolver`、移植的原版猫 `classicSolver`，浏览器和 Node 通用 |
| `bench/sim.js` | 无界面的游戏规则、随机开局、两个电脑玩家 |
| `bench/bench.js` | 对比脚本 |
| `test/` | 单元测试和录下来的原版猫局面 |
| `vendor/` | 原作的构建产物 `catch-the-cat.js` 和 Phaser 3.16.1，原样复制 |

## 许可

MIT。`vendor/` 里是第三方代码，各自是 MIT 许可：`catch-the-cat.js` 版权属于 Ganlv（见 `vendor/LICENSE-phaser-catch-the-cat`），`phaser.min.js` 是 Phaser 3.16.1（Photon Storm Ltd.）。游戏玩法和小猫图片最早来自 [Chat Noir](https://www.gamedesign.jp/flash/chatnoir/chatnoir.html)。
