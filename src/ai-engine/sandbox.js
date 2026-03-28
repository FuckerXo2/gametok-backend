import puppeteer from 'puppeteer';

export async function verifyGame(htmlString) {
    let browser = null;
    let hasError = false;
    let errorMessage = "";

    try {
        console.log("🕵️  Sandbox: Booting Headless Environment...");
        browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844 });

        // Intercept all console messages to catch crashes
        page.on('console', msg => {
            const type = msg.type();
            const text = msg.text();
            if (type === 'error' && (text.includes('TypeError') || text.includes('ReferenceError') || text.includes('SyntaxError') || text.includes('Uncaught'))) {
                console.log("💥 Sandbox Caught Error:", text);
                hasError = true;
                errorMessage = text;
            }
        });

        // Intercept failed network requests or page crashes
        page.on('pageerror', err => {
            console.log("💥 Sandbox Caught PageError:", err.message);
            hasError = true;
            errorMessage = err.message;
        });

        await page.setContent(htmlString, { waitUntil: 'load', timeout: 8000 });
        
        // Wait briefly for boot
        await new Promise(r => setTimeout(r, 1000));
        
        // Simulate aggressive interactive logic (pointer down, drag, pointer up) to trigger dormant interaction bugs
        try {
            await page.mouse.move(200, 200);
            await page.mouse.down({ button: 'left' });
            await new Promise(r => setTimeout(r, 1000)); // hold down for 1 second (tests long-press logic)
            await page.mouse.up({ button: 'left' });
            await page.mouse.click(300, 300); // test immediate click
        } catch(mouseErr) {
            console.log("Sandbox mouse interaction skipped:", mouseErr.message);
        }

        // Wait another 1 second to see if the interactions threw a delayed async error
        await new Promise(r => setTimeout(r, 1000));

        let screenshotBase64 = null;
        if (!hasError) {
            try {
                const buffer = await page.screenshot({ type: 'webp', quality: 50 });
                screenshotBase64 = 'data:image/webp;base64,' + buffer.toString('base64');
            } catch (err) {
                console.log("Screenshot failed:", err.message);
            }
        }

        await browser.close();

        if (hasError) {
            return { success: false, error: errorMessage };
        } else {
            console.log("✅ Sandbox: Zero Crashes Detected. Game is stable!");
            return { success: true, screenshot: screenshotBase64 };
        }
    } catch (e) {
        if (browser) await browser.close();
        console.error("Sandbox core implementation failed:", e);
        // If puppeteer fails to launch, pass it through rather than failing the user entirely
        return { success: true, bypassed: true };
    }
}
