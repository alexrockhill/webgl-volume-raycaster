'use strict';

const path = require('path');
const http = require('http');
const fs   = require('fs');
const { chromium } = require('playwright');

jest.setTimeout(60000);

const PORT       = 8182;
const ROOT       = path.join(__dirname, '..');
const CHROME     = process.env.CHROMIUM_PATH ||
                   '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome';
const BABYLON_JS = path.join(ROOT, 'node_modules', 'babylonjs', 'babylon.js');

const MIME = {
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.png':  'image/png',
};

function startServer() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const filePath = path.join(ROOT, req.url.split('?')[0]);
            try {
                const data = fs.readFileSync(filePath);
                const ext  = path.extname(filePath);
                res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
                res.end(data);
            } catch (_) {
                res.writeHead(404);
                res.end('Not found');
            }
        });
        server.listen(PORT, () => resolve(server));
        server.on('error', reject);
    });
}

// Read non-black pixel count from the Babylon.js canvas using a 2D offscreen copy.
// preserveDrawingBuffer:true is set in the engine so drawImage works after the frame.
const COUNT_NON_BLACK = () => {
    const canvas = document.getElementById('renderCanvas');
    if (!canvas || !canvas.width || !canvas.height) return 0;
    const off = document.createElement('canvas');
    off.width  = canvas.width;
    off.height = canvas.height;
    const ctx  = off.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    const px = ctx.getImageData(0, 0, off.width, off.height).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
        if (px[i] > 10 || px[i + 1] > 10 || px[i + 2] > 10) n++;
    }
    return n;
};

describe('Volume render – visual pixel check', () => {
    let server, browser, page;

    beforeAll(async () => {
        server = await startServer();

        browser = await chromium.launch({
            executablePath: CHROME,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--enable-webgl',
                '--use-gl=swiftshader',
                '--ignore-gpu-blocklist',
            ],
        });

        page = await browser.newPage();
        await page.setViewportSize({ width: 400, height: 400 });

        // Intercept the Babylon.js CDN request so the test runs offline
        await page.route('https://cdn.babylonjs.com/babylon.js', route =>
            route.fulfill({
                contentType: 'application/javascript',
                body: fs.readFileSync(BABYLON_JS),
            })
        );

        await page.goto(`http://localhost:${PORT}/babylon-fuel-demo.html`);

        // Load synthetic volume – no network request, pure JS data generation
        await page.click('#btnSynth');

        // Poll until at least one non-black pixel appears
        await page.waitForFunction(
            /* istanbul ignore next */ () => {
                const canvas = document.getElementById('renderCanvas');
                if (!canvas || !canvas.width || !canvas.height) return false;
                const off = document.createElement('canvas');
                off.width = canvas.width; off.height = canvas.height;
                const ctx = off.getContext('2d');
                ctx.drawImage(canvas, 0, 0);
                const px = ctx.getImageData(0, 0, off.width, off.height).data;
                for (let i = 0; i < px.length; i += 4) {
                    if (px[i] > 10 || px[i + 1] > 10 || px[i + 2] > 10) return true;
                }
                return false;
            },
            { timeout: 30000 }
        );
    });

    afterAll(async () => {
        await browser?.close();
        await new Promise(resolve => server?.close(resolve));
    });

    test('canvas contains non-black RGB pixels after volume renders', async () => {
        const nonBlack = await page.evaluate(COUNT_NON_BLACK);
        expect(nonBlack).toBeGreaterThan(0);
    });

    test('more than 1% of canvas pixels are non-black (volume has visible extent)', async () => {
        const { nonBlack, total } = await page.evaluate(() => {
            const canvas = document.getElementById('renderCanvas');
            const off = document.createElement('canvas');
            off.width = canvas.width; off.height = canvas.height;
            const ctx = off.getContext('2d');
            ctx.drawImage(canvas, 0, 0);
            const px = ctx.getImageData(0, 0, off.width, off.height).data;
            let n = 0;
            for (let i = 0; i < px.length; i += 4) {
                if (px[i] > 10 || px[i + 1] > 10 || px[i + 2] > 10) n++;
            }
            return { nonBlack: n, total: px.length / 4 };
        });
        expect(nonBlack / total).toBeGreaterThan(0.01);
    });
});
