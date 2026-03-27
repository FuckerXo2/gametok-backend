import { compileGameHTML } from './src/ai-engine/compiler.js';
import { verifyGame } from './src/ai-engine/sandbox.js';

const json = {
    title: "Test",
    engine: "canvas2d",
    settings: {},
    code: `
        var canvas = document.getElementById('game-canvas');
        var ctx = canvas.getContext('2d');
        var W = canvas.width, H = canvas.height;
        ctx.fillStyle = 'red';
        ctx.fillRect(0, 0, W, H);
        console.log("Canvas2D tested!");
    `
};

const html = compileGameHTML(json, {});
verifyGame(html).then(res => {
    console.log("Sandbox Result:", JSON.stringify(res, null, 2));
    process.exit(0);
}).catch(e => {
    console.error("Test Error", e);
    process.exit(1);
});
