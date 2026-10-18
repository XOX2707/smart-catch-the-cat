/*!
 * 格格: a pixel-art grey tabby skin for the cat.
 *
 * Every sprite is a list of equal-length strings, one character per art
 * pixel. "." is transparent; other letters are looked up in `palette`.
 * `anchor` is the art pixel that stands on the centre of the cat's dot
 * (roughly between the feet).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.CatSkins = root.CatSkins || {};
        root.CatSkins.gege = factory();
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var palette = {
        K: "#2b2f36", // outline
        G: "#8d9aa9", // fur
        D: "#5f6b78", // stripes, far legs
        L: "#d9e0e7", // muzzle, belly
        W: "#ffffff", // eye shine
        Y: "#f2c94c", // eyes
        E: "#2b2f36", // pupils
        P: "#f2a1b5", // inner ears, paw pads
        N: "#e2788f", // nose
    };

    // ---------- side view, walking left ----------
    var sideTop = [
        "..K....K..............",
        ".KPK..KPK.............",
        ".KPGKKGPK.........KK..",
        ".KGGGGGGK........KGGK.",
        "KGGDGGDGGK.......KGK..",
        "KGYEGGYEGK.......KGK..",
        "KGWYGGWYGK.......KGK..",
        "KLLGNGGLLKKKKKKKKKGK..",
        ".KLLLLLKGGDGGDGGDGK...",
        "..KKKKGGGGGGGGGGGGK...",
        "....KLGGGGGGGGGGGGK...",
        "....KLLLLGGGGGGGGK....",
        ".....KKKKKKKKKKKKK....",
    ];
    // Legs under the body: near legs grey, far legs dark.
    var sideLegs = [
        // standing
        [".....KGKKDK..KDKKGK...",
         ".....KGKKDK..KDKKGK...",
         ".....KKKKKK..KKKKKK..."],
        // walk 1: near front forward, near back back
        ["....KGK.KDK..KDK.KGK..",
         "...KGK...KDK.KDK..KGK.",
         "...KKK...KKK.KKK..KKK."],
        // walk 2: legs passing
        [".....KGKKDK..KDKKGK...",
         "......KGKDK..KDKGK....",
         "......KKKKK..KKKKK...."],
        // walk 3: near front back, near back forward
        ["....KDK.KGK..KGK.KDK..",
         "...KDK...KGK.KGK..KDK.",
         "...KKK...KKK.KKK..KKK."],
        // walk 4: legs passing the other way
        [".....KDKKGK..KGKKDK...",
         "......KDKGK..KGKDK....",
         "......KKKKK..KKKKK...."],
    ];

    function side(frame) {
        var bob = frame === 1 || frame === 3;
        var rows = sideTop.concat(sideLegs[frame]);
        return bob ? ["......................"].concat(rows.slice(0, rows.length - 1)) : rows;
    }

    var sideCaught = [
        ".K.K..K.K.........K...",
        "KPKKKKPK.........KGK.K",
        "KPGGGGPK.....K.K.KGKK.",
        "KGGGGGGGK.K.KGKGKKGK..",
        "KGYYGGYYGKGKGGGGGKGK.K",
        "KGYEGGYEGKGGDGGDGGGKK.",
        "KGWYGGWYGKGGGGGGGGGK..",
        "KLLGNNGLLKGGGGGGGGGK..",
        ".KLLKKLLKGGGGGGGGGK.K.",
        "K.KKKKKKGGGGGGGGGGK...",
        "...KLLLLGGGGGGGGGK....",
        "....KKKKKKKKKKKKKK....",
        "....KGK.KDK.KDK.KGK...",
        "....KGK.KDK.KDK.KGK...",
        "...KKKK.KKK.KKK.KKKK..",
    ];

    // ---------- back view, walking up and to the left ----------
    var backTop = [
        "..K.......K.....",
        ".KPK.....KPK....",
        ".KGGK...KGGK....",
        ".KGGGKKKGGGK....",
        "KGGDGGDGGDGGK...",
        "KGGGGDGDGGGGK.K.",
        ".KGGGGGGGGGK.KGK",
        "..KKGGGGGKK..KGK",
        ".KGGGGDGGGGK.KGK",
        "KGGDGGDGGDGGKKGK",
        "KGGGGGDGGGGGGKK.",
        "KGGDGGDGGDGGK...",
        "KGGGGGDGGGGGK...",
        ".KGGGGGGGGGK....",
        "..KKKKKKKKK.....",
    ];
    // Seen from behind, the back legs take turns lifting.
    var backLegs = [
        ["..KGK...KGK.....",
         "..KGK...KGK.....",
         "..KKK...KKK....."],
        ["..KGK...KGK.....",
         "..KKK...KGK.....",
         "........KKK....."],
        ["..KGK...KGK.....",
         "..KGK...KGK.....",
         "..KKK...KKK....."],
        ["..KGK...KGK.....",
         "..KGK...KKK.....",
         "..KKK..........."],
        ["..KGK...KGK.....",
         "..KGK...KGK.....",
         "..KKK...KKK....."],
    ];

    function back(frame) {
        return backTop.concat(backLegs[frame]);
    }

    // ---------- front view, walking down and to the left ----------
    var frontTop = [
        "..K.......K.....",
        ".KPK.....KPK....",
        ".KPGK...KGPK....",
        ".KGGGKKKGGGK....",
        "KGGDGGDGGDGGK...",
        "KGYEGGGGGYEGK...",
        "KGWYGGGGGWYGK..K",
        "KLLGGGNGGGLLK.KG",
        ".KLLLLLLLLLK..KG",
        "..KKKLLLKKK...KG",
        "..KGGLLLGGK..KGK",
        ".KGGGLLLGGGKKGK.",
        ".KGGGLLLGGGGKK..",
        ".KGGGGLGGGGGK...",
    ];
    var frontLegs = [
        ["..KLK.....KLK...",
         "..KPK.....KPK..."],
        [".KLK.......KLK..",
         ".KPK........KPK."],
        ["..KLK.....KLK...",
         "...KPK...KPK...."],
        ["...KLK...KLK....",
         "..KPK.....KPK..."],
        ["..KLK.....KLK...",
         "...KPK...KPK...."],
    ];

    function front(frame) {
        var bob = frame === 1 || frame === 3;
        var rows = frontTop.concat(frontLegs[frame]);
        return bob ? ["................"].concat(rows.slice(0, rows.length - 1)) : rows;
    }

    var frontCaught = [
        "K.K.......K.K.K.",
        ".KPK.K.K.KPK.KGK",
        "KKPGKKKKKGPKK.KG",
        ".KGGGGGGGGGK..KG",
        "KGGDGGDGGDGGK.KG",
        "KGYYGGGGGYYGK.KG",
        "KGYEGGGGGYEGKKGK",
        "KGWYGGGGGWYGKGK.",
        "KLLGGKNKGGLLKK..",
        ".KLLLKKKLLLLK...",
        "K.KKKKKKKKKK.K..",
        ".KGGGLLLGGGK....",
        "KGGGGLLLGGGGK...",
        ".KGGGGGGGGGK.K..",
        "..KGK...KGK.....",
        "..KGK...KGK.....",
        ".KKKK...KKKK....",
    ];

    function frames(fn) {
        return [fn(0), fn(1), fn(2), fn(3), fn(4)];
    }

    return {
        name: "格格",
        palette: palette,
        directions: {
            left: {frames: frames(side), caught: sideCaught, anchor: [11, 15]},
            top_left: {frames: frames(back), caught: frontCaught, anchor: [6, 17]},
            bottom_left: {frames: frames(front), caught: frontCaught, anchor: [7, 15]},
        },
    };
});
