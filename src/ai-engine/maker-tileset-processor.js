function stripDataUrl(imageBase64OrDataUrl) {
    return String(imageBase64OrDataUrl || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
}

function tileName(row, col) {
    return [
        ['top_left', 'top', 'top_right'],
        ['left', 'center', 'right'],
        ['bottom_left', 'bottom', 'bottom_right'],
    ][row][col];
}

async function sliceCoreTiles(coreImageBase64OrDataUrl, tileSize = 32) {
    const sharp = (await import('sharp')).default;
    const input = Buffer.from(stripDataUrl(coreImageBase64OrDataUrl), 'base64');
    const normalized = await sharp(input)
        .resize(tileSize * 3, tileSize * 3, {
            fit: 'fill',
            kernel: 'nearest',
        })
        .png()
        .toBuffer();

    const tiles = {};
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            tiles[tileName(row, col)] = await sharp(normalized)
                .extract({
                    left: col * tileSize,
                    top: row * tileSize,
                    width: tileSize,
                    height: tileSize,
                })
                .png()
                .toBuffer();
        }
    }
    return tiles;
}

async function makeInnerCornerTile({ center, corner, horizontal, vertical, tileSize }) {
    const sharp = (await import('sharp')).default;
    const half = Math.floor(tileSize / 2);
    const remainder = tileSize - half;
    const cornerPatch = await sharp(corner)
        .extract({ left: 0, top: 0, width: half, height: half })
        .png()
        .toBuffer();
    const horizontalPatch = await sharp(horizontal)
        .extract({ left: half, top: 0, width: remainder, height: half })
        .png()
        .toBuffer();
    const verticalPatch = await sharp(vertical)
        .extract({ left: 0, top: half, width: half, height: remainder })
        .png()
        .toBuffer();
    return sharp(center)
        .composite([
            { input: cornerPatch, left: 0, top: 0 },
            { input: horizontalPatch, left: half, top: 0 },
            { input: verticalPatch, left: 0, top: half },
        ])
        .png()
        .toBuffer();
}

async function buildExpandedTileMatrix(coreTiles, tileSize) {
    const center = coreTiles.center;
    const innerTopLeft = await makeInnerCornerTile({
        center,
        corner: coreTiles.top_left,
        horizontal: coreTiles.top,
        vertical: coreTiles.left,
        tileSize,
    });
    const innerTopRight = await makeInnerCornerTile({
        center,
        corner: coreTiles.top_right,
        horizontal: coreTiles.top,
        vertical: coreTiles.right,
        tileSize,
    });
    const innerBottomLeft = await makeInnerCornerTile({
        center,
        corner: coreTiles.bottom_left,
        horizontal: coreTiles.bottom,
        vertical: coreTiles.left,
        tileSize,
    });
    const innerBottomRight = await makeInnerCornerTile({
        center,
        corner: coreTiles.bottom_right,
        horizontal: coreTiles.bottom,
        vertical: coreTiles.right,
        tileSize,
    });

    return [
        [coreTiles.top_left, coreTiles.top, coreTiles.top, coreTiles.top, coreTiles.top, coreTiles.top, coreTiles.top_right],
        [coreTiles.left, innerTopLeft, coreTiles.top, coreTiles.top, coreTiles.top, innerTopRight, coreTiles.right],
        [coreTiles.left, coreTiles.left, center, center, center, coreTiles.right, coreTiles.right],
        [coreTiles.left, coreTiles.left, center, center, center, coreTiles.right, coreTiles.right],
        [coreTiles.left, coreTiles.left, center, center, center, coreTiles.right, coreTiles.right],
        [coreTiles.left, innerBottomLeft, coreTiles.bottom, coreTiles.bottom, coreTiles.bottom, innerBottomRight, coreTiles.right],
        [coreTiles.bottom_left, coreTiles.bottom, coreTiles.bottom, coreTiles.bottom, coreTiles.bottom, coreTiles.bottom, coreTiles.bottom_right],
    ];
}

export async function expandCoreTileset3x3To7x7(coreImageBase64OrDataUrl, { tileSize = 32 } = {}) {
    const sharp = (await import('sharp')).default;
    const normalizedTileSize = Math.max(8, Math.min(128, Number(tileSize || 32)));
    const coreTiles = await sliceCoreTiles(coreImageBase64OrDataUrl, normalizedTileSize);
    const matrix = await buildExpandedTileMatrix(coreTiles, normalizedTileSize);
    const composites = [];
    for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 7; col++) {
            composites.push({
                input: matrix[row][col],
                left: col * normalizedTileSize,
                top: row * normalizedTileSize,
            });
        }
    }
    const expanded = await sharp({
        create: {
            width: normalizedTileSize * 7,
            height: normalizedTileSize * 7,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
    })
        .composite(composites)
        .png()
        .toBuffer();

    return {
        dataUri: `data:image/png;base64,${expanded.toString('base64')}`,
        tileSize: normalizedTileSize,
        columns: 7,
        rows: 7,
        sourceColumns: 3,
        sourceRows: 3,
        tileKeys: [
            'top_left',
            'top',
            'top_right',
            'left',
            'center',
            'right',
            'bottom_left',
            'bottom',
            'bottom_right',
        ],
    };
}
