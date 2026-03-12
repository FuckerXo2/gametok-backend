import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const gameNames = {
    206: 'Stack Ball',
    319: 'Color Road',
    413: 'Helix Jump',
    416: 'Knife Hit',
    417: 'Fire Balls 3D',
    423: 'Twist',
    425: 'Rise Up',
    432: 'Jelly Shift',
    439: 'Perfect Slices',
    441: 'Rolly Vortex',
    466: 'Aquapark.io',
    467: 'Fun Race 3D',
    468: 'Crowd City',
    469: 'Hole.io',
    471: 'Paper.io 2',
    578: 'Spiral Roll',
    633: 'Roof Rails',
    690: 'Shortcut Run',
    691: 'Bridge Race',
    694: 'Join Clash',
    720: 'Tall Man Run',
    729: 'Count Masters',
    755: 'Blob Runner 3D',
    760: 'Muscle Race 3D',
    762: 'Twerk Race 3D',
    778: 'Money Rush',
    799: 'Makeup Run',
    817: 'High Heels',
    822: 'Shoe Race',
    836: 'Body Race',
    840: 'Balloon Pop',
    844: 'Crowd Evolution',
    857: 'Parkour Race',
    862: 'Roof Rails Online',
    936: 'Draw Climber',
    958: 'Flip Dunk'
};

const outputDir = path.join(process.cwd(), 'public', 'thumbnails');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

async function downloadImage(url, dest) {
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/115.0'
            }
        });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength < 500) return false;
        fs.writeFileSync(dest, Buffer.from(buffer));
        return true;
    } catch (err) {
        console.error(`Failed to download ${url}: ${err.message}`);
        return false;
    }
}

async function run() {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    for (const [id, name] of Object.entries(gameNames)) {
        const dest = path.join(outputDir, `loops_${id}.png`);
        if (fs.existsSync(dest)) {
            console.log(`Skipping ${name}, already exists`);
            continue;
        }
        console.log(`Searching for "${name} game thumbnail"...`);

        try {
            const q = encodeURIComponent(`${name} game app icon`);
            await page.goto(`https://www.google.com/search?q=${q}&tbm=isch`, { waitUntil: 'domcontentloaded' });
            await new Promise(r => setTimeout(r, 1000));

            const images = await page.evaluate(() => {
                // Collect all image sources
                const imgs = Array.from(document.querySelectorAll('img'));
                const validImgs = imgs.map(img => img.src || img.getAttribute('data-src'))
                    .filter(src => src && (src.startsWith('http') || src.startsWith('data:image')));
                return validImgs.slice(1, 4); // skip the very first one which is usually Google logo
            });

            let success = false;
            for (const imgUrl of images) {
                if (!imgUrl) continue;
                console.log(`Trying an image...`);
                // If it's a data URI, we can just save it!
                if (imgUrl.startsWith('data:image')) {
                    const base64Data = imgUrl.replace(/^data:image\/\w+;base64,/, "");
                    if (base64Data.length > 500) {
                        fs.writeFileSync(dest, Buffer.from(base64Data, 'base64'));
                        console.log(`=> Saved base64 for ${name}`);
                        success = true;
                        break;
                    }
                } else {
                    success = await downloadImage(imgUrl, dest);
                    if (success) {
                        console.log(`=> Downloaded url for ${name}`);
                        break;
                    }
                }
            }

            if (!success) {
                console.log(`=> Could not download an image for ${name}`);
            }
        } catch (err) {
            console.error(`Error scraping ${name}:`, err.message);
        }
    }

    await browser.close();
    console.log('Done!');
}

run();
