// GOLD STANDARD: MATCH-3
// Flawless, crash-free array grid logic.
const config = { type: Phaser.AUTO, width: window.innerWidth, height: window.innerHeight, backgroundColor: '#1E1E2E', parent: 'game-container', scene: { create, update } };
window.game = new Phaser.Game(config);

let grid = [], score = 0, rows = 8, cols = 6, tileSize = 0, offsetX = 0, offsetY = 0;
let canMove = true, selectedTile = null;

function create() {
    window.showUI(); window.updateScore(0); window.initLives(0);
    tileSize = Math.min(window.innerWidth / (cols + 1), 60);
    offsetX = (window.innerWidth - (cols * tileSize)) / 2 + (tileSize/2);
    offsetY = (window.innerHeight - (rows * tileSize)) / 2 + (tileSize/2);

    // AI SHOULD CUSTOMIZE THESE PROCEDURAL ASSETS (Candy, Gems, Meat slabs, etc)
    const colors = [0xFF595E, 0xFFCA3A, 0x8AC926, 0x1982C4, 0x6A4C93];
    for(let i=0; i<colors.length; i++) {
        let g = this.make.graphics();
        g.fillStyle(colors[i]); g.fillRoundedRect(4, 4, tileSize-8, tileSize-8, 10);
        g.lineStyle(2, 0xFFFFFF, 0.5); g.strokeRoundedRect(4,4, tileSize-8, tileSize-8, 10);
        g.generateTexture('gem'+i, tileSize, tileSize); g.destroy();
    }

    // Build logic grid
    for(let r = 0; r < rows; r++) {
        grid[r] = [];
        for(let c = 0; c < cols; c++) {
            let type = Phaser.Math.Between(0, colors.length-1);
            let sprite = this.add.sprite(offsetX + c*tileSize, offsetY + r*tileSize, 'gem'+type).setInteractive();
            sprite.typeId = type; sprite.row = r; sprite.col = c;
            grid[r][c] = sprite;
        }
    }

    this.input.on('gameobjectdown', (pointer, sprite) => {
        if (!canMove) return;
        if (!selectedTile) {
            selectedTile = sprite; sprite.setAlpha(0.5); window.playSound('jump');
        } else {
            let isAdjacent = (Math.abs(selectedTile.row - sprite.row) + Math.abs(selectedTile.col - sprite.col) === 1);
            if (isAdjacent) swap(this, selectedTile, sprite);
            else { selectedTile.setAlpha(1); selectedTile = sprite; sprite.setAlpha(0.5); window.playSound('jump'); }
        }
    });
}

function update() {}

function swap(scene, t1, t2) {
    canMove = false; t1.setAlpha(1); t2.setAlpha(1); selectedTile = null;
    let r1=t1.row, c1=t1.col, r2=t2.row, c2=t2.col;
    grid[r1][c1]=t2; grid[r2][c2]=t1;
    t1.row=r2; t1.col=c2; t2.row=r1; t2.col=c1;
    
    scene.tweens.add({ targets: t1, x: offsetX + c2*tileSize, y: offsetY + r2*tileSize, duration: 200, ease: 'Linear' });
    scene.tweens.add({ targets: t2, x: offsetX + c1*tileSize, y: offsetY + r1*tileSize, duration: 200, ease: 'Linear', onComplete: () => {
        if (!checkMatches(scene)) {
            // Swap back if no match
            grid[r1][c1]=t1; grid[r2][c2]=t2;
            t1.row=r1; t1.col=c1; t2.row=r2; t2.col=c2;
            scene.tweens.add({ targets: t1, x: offsetX + c1*tileSize, y: offsetY + r1*tileSize, duration: 200 });
            scene.tweens.add({ targets: t2, x: offsetX + c2*tileSize, y: offsetY + r2*tileSize, duration: 200, onComplete: () => canMove=true });
        }
    } });
}

function checkMatches(scene) {
    let matched = new Set();
    // CRITICAL: Always bounds-check match-3 algorithms!
    for(let r=0; r<rows; r++) {
        for(let c=0; c<cols-2; c++) {
            if(grid[r] && grid[r][c] && grid[r][c+1] && grid[r][c+2]) {
                if(grid[r][c].typeId === grid[r][c+1].typeId && grid[r][c].typeId === grid[r][c+2].typeId) {
                    matched.add(grid[r][c]); matched.add(grid[r][c+1]); matched.add(grid[r][c+2]);
                }
            }
        }
    }
    for(let c=0; c<cols; c++) {
        for(let r=0; r<rows-2; r++) {
            if(grid[r] && grid[r+1] && grid[r+2] && grid[r][c] && grid[r+1][c] && grid[r+2][c]) {
                if(grid[r][c].typeId === grid[r+1][c].typeId && grid[r][c].typeId === grid[r+2][c].typeId) {
                    matched.add(grid[r][c]); matched.add(grid[r+1][c]); matched.add(grid[r+2][c]);
                }
            }
        }
    }
    if (matched.size > 0) {
        window.playSound('match'); score += matched.size * 10; window.updateScore(score);
        matched.forEach(t => { t.destroy(); grid[t.row][t.col] = null; });
        setTimeout(() => fallDown(scene), 100);
        return true;
    }
    canMove = true; return false;
}

function fallDown(scene) {
    let moved = false;
    for(let c=0; c<cols; c++) {
        let emptySpaces = 0;
        for(let r=rows-1; r>=0; r--) {
            if(!grid[r][c]) emptySpaces++;
            else if(emptySpaces > 0 && grid[r][c]) {
                let t = grid[r][c];
                grid[r+emptySpaces][c] = t; grid[r][c] = null; t.row = r + emptySpaces;
                scene.tweens.add({targets:t, y: offsetY + t.row*tileSize, duration: 200});
                moved = true;
            }
        }
        for(let r=0; r<emptySpaces; r++) { // Refill
            let type = Phaser.Math.Between(0, 4);
            let t = scene.add.sprite(offsetX + c*tileSize, offsetY - (emptySpaces-r)*tileSize, 'gem'+type).setInteractive();
            t.typeId = type; t.row = r; t.col = c; grid[r][c] = t;
            scene.tweens.add({targets:t, y: offsetY + r*tileSize, duration: 250});
            moved = true;
        }
    }
    setTimeout(() => { if (!checkMatches(scene)) canMove = true; }, 300);
}
