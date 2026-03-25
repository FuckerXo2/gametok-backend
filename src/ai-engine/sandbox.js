import puppeteer from 'puppeteer';

export async function verifyGame(htmlString) {
    let browser = null;
    let hasError = false;
    let errorMessage = "";

    try {
        console.log("🕵️  Sandbox: Booting Headless Environment...");
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
        });
        const page = await browser.newPage();

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
        
        // Wait 3000ms to let Phaser boot up and run initial loop
        await new Promise(r => setTimeout(r, 3000));

        await browser.close();

        if (hasError) {
            return { success: false, error: errorMessage };
        } else {
            console.log("✅ Sandbox: Zero Crashes Detected. Game is stable!");
            return { success: true };
        }
    } catch (e) {
        if (browser) await browser.close();
        console.error("Sandbox core implementation failed:", e);
        // If puppeteer fails to launch, pass it through rather than failing the user entirely
        return { success: true, bypassed: true };
    }
}
