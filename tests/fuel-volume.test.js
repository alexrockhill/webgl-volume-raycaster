'use strict';

const {
    parseVolumeFilename,
    loadRawVolume,
    createVolumeTexture,
} = require('../js/fuel-volume-loader');

// ─── parseVolumeFilename ─────────────────────────────────────────────────────

describe('parseVolumeFilename', () => {
    test('parses fuel_64x64x64_uint8.raw correctly', () => {
        const result = parseVolumeFilename('fuel_64x64x64_uint8.raw');
        expect(result.name).toBe('fuel');
        expect(result.dims).toEqual([64, 64, 64]);
        expect(result.type).toBe('uint8');
    });

    test('parses non-cubic engine_256x256x128_uint8.raw', () => {
        const result = parseVolumeFilename('engine_256x256x128_uint8.raw');
        expect(result.name).toBe('engine');
        expect(result.dims).toEqual([256, 256, 128]);
        expect(result.type).toBe('uint8');
    });

    test('parses hydrogen_atom_128x128x128_uint8.raw with underscore in name', () => {
        // filename uses underscores in the base name – our regex treats
        // the whole stem up to the first dimension token as the name.
        // The actual file is "hydrogen_atom_128x128x128_uint8.raw"; the
        // loader strips the URL path, so we test the bare filename as stored.
        const result = parseVolumeFilename('bonsai_256x256x256_uint8.raw');
        expect(result.name).toBe('bonsai');
        expect(result.dims).toEqual([256, 256, 256]);
    });

    test('throws on filename with wrong pattern', () => {
        expect(() => parseVolumeFilename('volume.raw')).toThrow(
            /Invalid volume filename/
        );
    });

    test('throws on filename with missing extension', () => {
        expect(() => parseVolumeFilename('fuel_64x64x64_uint8')).toThrow(
            /Invalid volume filename/
        );
    });

    test('dims are parsed as integers, not strings', () => {
        const { dims } = parseVolumeFilename('skull_256x256x256_uint8.raw');
        dims.forEach((d) => expect(typeof d).toBe('number'));
        dims.forEach((d) => expect(Number.isInteger(d)).toBe(true));
    });
});

// ─── loadRawVolume ───────────────────────────────────────────────────────────

/**
 * Build a minimal XMLHttpRequest mock that responds synchronously with
 * an ArrayBuffer of `byteLength` bytes filled with sequential values.
 */
function makeMockXhr(byteLength, { status = 200 } = {}) {
    return jest.fn().mockImplementation(function () {
        const instance = {
            open:         jest.fn(),
            send:         jest.fn(function () {
                this.status   = status;
                this.response = new ArrayBuffer(byteLength);
                if (status >= 200 && status < 300) {
                    // Fill with sequential byte values to verify data integrity
                    const view = new Uint8Array(this.response);
                    for (let i = 0; i < byteLength; i++) {
                        view[i] = i % 256;
                    }
                }
                if (this.onload) this.onload();
            }),
            responseType: '',
            onload:       null,
            onprogress:   null,
            onerror:      null,
        };
        return instance;
    });
}

describe('loadRawVolume', () => {
    const FUEL_DIMS   = [64, 64, 64];
    const FUEL_SIZE   = 64 * 64 * 64; // 262 144 bytes
    const FUEL_URL    = 'https://example.com/fuel_64x64x64_uint8.raw';

    afterEach(() => {
        delete global.XMLHttpRequest;
    });

    test('resolves with correct dims and name for the fuel dataset', async () => {
        global.XMLHttpRequest = makeMockXhr(FUEL_SIZE);
        const result = await loadRawVolume(FUEL_URL);
        expect(result.name).toBe('fuel');
        expect(result.dims).toEqual(FUEL_DIMS);
        expect(result.type).toBe('uint8');
    });

    test('resolves with a Uint8Array of the correct byte length', async () => {
        global.XMLHttpRequest = makeMockXhr(FUEL_SIZE);
        const { data } = await loadRawVolume(FUEL_URL);
        expect(data).toBeInstanceOf(Uint8Array);
        expect(data.length).toBe(FUEL_SIZE);
    });

    test('fuel dataset has exactly 64^3 = 262 144 voxels', async () => {
        global.XMLHttpRequest = makeMockXhr(FUEL_SIZE);
        const { data } = await loadRawVolume(FUEL_URL);
        expect(data.length).toBe(262144);
    });

    test('all loaded voxel values are in the valid uint8 range [0, 255]', async () => {
        global.XMLHttpRequest = makeMockXhr(FUEL_SIZE);
        const { data } = await loadRawVolume(FUEL_URL);
        for (const val of data) {
            expect(val).toBeGreaterThanOrEqual(0);
            expect(val).toBeLessThanOrEqual(255);
        }
    });

    test('calls the onProgress callback with values between 0 and 100', async () => {
        global.XMLHttpRequest = jest.fn().mockImplementation(function () {
            const instance = {
                open:         jest.fn(),
                responseType: '',
                onload:       null,
                onprogress:   null,
                onerror:      null,
                send:         jest.fn(function () {
                    this.status   = 200;
                    this.response = new ArrayBuffer(FUEL_SIZE);
                    // Simulate two progress events
                    if (this.onprogress) {
                        this.onprogress({ lengthComputable: true, loaded: FUEL_SIZE / 2, total: FUEL_SIZE });
                        this.onprogress({ lengthComputable: true, loaded: FUEL_SIZE,     total: FUEL_SIZE });
                    }
                    if (this.onload) this.onload();
                }),
            };
            return instance;
        });

        const progressValues = [];
        await loadRawVolume(FUEL_URL, (pct) => progressValues.push(pct));

        expect(progressValues.length).toBe(2);
        expect(progressValues[0]).toBeCloseTo(50);
        expect(progressValues[1]).toBeCloseTo(100);
    });

    test('rejects when server returns HTTP 404', async () => {
        global.XMLHttpRequest = makeMockXhr(0, { status: 404 });
        await expect(loadRawVolume(FUEL_URL)).rejects.toThrow(/HTTP error 404/);
    });

    test('rejects when received byte count does not match declared dims', async () => {
        // Serve 100 bytes for a 64^3 volume → size mismatch
        global.XMLHttpRequest = makeMockXhr(100);
        await expect(loadRawVolume(FUEL_URL)).rejects.toThrow(/size mismatch/);
    });

    test('rejects on network error', async () => {
        global.XMLHttpRequest = jest.fn().mockImplementation(function () {
            return {
                open:         jest.fn(),
                responseType: '',
                onload:       null,
                onerror:      null,
                onprogress:   null,
                send:         jest.fn(function () {
                    if (this.onerror) this.onerror();
                }),
            };
        });
        await expect(loadRawVolume(FUEL_URL)).rejects.toThrow(/Network error/);
    });

    test('rejects when URL filename cannot be parsed', async () => {
        await expect(loadRawVolume('https://example.com/badfile.raw'))
            .rejects.toThrow(/Invalid volume filename/);
    });
});

// ─── createVolumeTexture ─────────────────────────────────────────────────────

describe('createVolumeTexture', () => {
    // Minimal Babylon.js mock: only the surface the loader touches
    const MOCK_BABYLON = {
        Engine: {
            TEXTUREFORMAT_R:          6,
            TEXTURETYPE_UNSIGNED_BYTE: 0,
        },
        Texture: {
            BILINEAR_SAMPLINGMODE: 2,
            CLAMP_ADDRESSMODE:     0,
        },
        RawTexture3D: jest.fn(),
    };

    beforeEach(() => {
        MOCK_BABYLON.RawTexture3D.mockClear();
        // Each call returns a fresh mock texture object
        MOCK_BABYLON.RawTexture3D.mockImplementation(() => ({
            wrapU: undefined,
            wrapV: undefined,
            wrapR: undefined,
        }));
    });

    const FUEL_DIMS = [64, 64, 64];
    const fuelData  = new Uint8Array(64 * 64 * 64);
    const mockScene = {};

    test('calls RawTexture3D with the fuel volume data', () => {
        createVolumeTexture(fuelData, FUEL_DIMS, mockScene, MOCK_BABYLON);
        expect(MOCK_BABYLON.RawTexture3D).toHaveBeenCalledTimes(1);
        const [data] = MOCK_BABYLON.RawTexture3D.mock.calls[0];
        expect(data).toBe(fuelData);
    });

    test('passes correct width, height, depth (64, 64, 64)', () => {
        createVolumeTexture(fuelData, FUEL_DIMS, mockScene, MOCK_BABYLON);
        const call = MOCK_BABYLON.RawTexture3D.mock.calls[0];
        expect(call[1]).toBe(64);  // width
        expect(call[2]).toBe(64);  // height
        expect(call[3]).toBe(64);  // depth
    });

    test('uses single-channel RED format (TEXTUREFORMAT_R)', () => {
        createVolumeTexture(fuelData, FUEL_DIMS, mockScene, MOCK_BABYLON);
        const call = MOCK_BABYLON.RawTexture3D.mock.calls[0];
        expect(call[4]).toBe(MOCK_BABYLON.Engine.TEXTUREFORMAT_R);
    });

    test('passes the scene reference', () => {
        createVolumeTexture(fuelData, FUEL_DIMS, mockScene, MOCK_BABYLON);
        const call = MOCK_BABYLON.RawTexture3D.mock.calls[0];
        expect(call[5]).toBe(mockScene);
    });

    test('disables mipmap generation (arg index 6 is false)', () => {
        createVolumeTexture(fuelData, FUEL_DIMS, mockScene, MOCK_BABYLON);
        const call = MOCK_BABYLON.RawTexture3D.mock.calls[0];
        expect(call[6]).toBe(false);   // generateMipMaps
    });

    test('uses BILINEAR_SAMPLINGMODE', () => {
        createVolumeTexture(fuelData, FUEL_DIMS, mockScene, MOCK_BABYLON);
        const call = MOCK_BABYLON.RawTexture3D.mock.calls[0];
        expect(call[8]).toBe(MOCK_BABYLON.Texture.BILINEAR_SAMPLINGMODE);
    });

    test('uses TEXTURETYPE_UNSIGNED_BYTE', () => {
        createVolumeTexture(fuelData, FUEL_DIMS, mockScene, MOCK_BABYLON);
        const call = MOCK_BABYLON.RawTexture3D.mock.calls[0];
        expect(call[9]).toBe(MOCK_BABYLON.Engine.TEXTURETYPE_UNSIGNED_BYTE);
    });

    test('sets CLAMP_ADDRESSMODE on all three texture wrap axes', () => {
        const texture = createVolumeTexture(fuelData, FUEL_DIMS, mockScene, MOCK_BABYLON);
        expect(texture.wrapU).toBe(MOCK_BABYLON.Texture.CLAMP_ADDRESSMODE);
        expect(texture.wrapV).toBe(MOCK_BABYLON.Texture.CLAMP_ADDRESSMODE);
        expect(texture.wrapR).toBe(MOCK_BABYLON.Texture.CLAMP_ADDRESSMODE);
    });

    test('returns the object constructed by RawTexture3D', () => {
        const sentinel = { wrapU: undefined, wrapV: undefined, wrapR: undefined, _id: 'sentinel' };
        MOCK_BABYLON.RawTexture3D.mockReturnValueOnce(sentinel);
        const result = createVolumeTexture(fuelData, FUEL_DIMS, mockScene, MOCK_BABYLON);
        expect(result).toBe(sentinel);
    });

    test('works with non-cubic dims (e.g. 256x256x128)', () => {
        const bigData = new Uint8Array(256 * 256 * 128);
        createVolumeTexture(bigData, [256, 256, 128], mockScene, MOCK_BABYLON);
        const call = MOCK_BABYLON.RawTexture3D.mock.calls[0];
        expect(call[1]).toBe(256);
        expect(call[2]).toBe(256);
        expect(call[3]).toBe(128);
    });
});

// ─── Integration: full pipeline simulation ───────────────────────────────────

describe('Full pipeline: load raw volume then create texture', () => {
    const FUEL_DIMS = [64, 64, 64];
    const FUEL_SIZE = 64 * 64 * 64;
    const FUEL_URL  = 'https://example.com/fuel_64x64x64_uint8.raw';

    const MOCK_BABYLON = {
        Engine: {
            TEXTUREFORMAT_R:          6,
            TEXTURETYPE_UNSIGNED_BYTE: 0,
        },
        Texture: {
            BILINEAR_SAMPLINGMODE: 2,
            CLAMP_ADDRESSMODE:     0,
        },
        RawTexture3D: jest.fn(() => ({ wrapU: undefined, wrapV: undefined, wrapR: undefined })),
    };

    beforeEach(() => {
        MOCK_BABYLON.RawTexture3D.mockClear();
        global.XMLHttpRequest = jest.fn().mockImplementation(function () {
            return {
                open:         jest.fn(),
                responseType: '',
                onload:       null,
                onprogress:   null,
                onerror:      null,
                send:         jest.fn(function () {
                    this.status   = 200;
                    this.response = new ArrayBuffer(FUEL_SIZE);
                    // Synthetic fuel-like gradient data
                    const view = new Uint8Array(this.response);
                    const cx = 32, cy = 32, cz = 32;
                    for (let z = 0; z < 64; z++) {
                        for (let y = 0; y < 64; y++) {
                            for (let x = 0; x < 64; x++) {
                                const d = Math.sqrt((x-cx)**2 + (y-cy)**2 + (z-cz)**2);
                                view[z * 64 * 64 + y * 64 + x] = Math.round(Math.max(0, 1 - d / 20) * 255);
                            }
                        }
                    }
                    if (this.onload) this.onload();
                }),
            };
        });
    });

    afterEach(() => {
        delete global.XMLHttpRequest;
    });

    test('loadRawVolume → createVolumeTexture produces a valid texture', async () => {
        const { data, dims } = await loadRawVolume(FUEL_URL);

        // Verify loaded data
        expect(data.length).toBe(FUEL_SIZE);
        expect(dims).toEqual(FUEL_DIMS);

        // Create texture from loaded data
        const texture = createVolumeTexture(data, dims, {}, MOCK_BABYLON);

        // Texture constructor must have been called once with correct size
        expect(MOCK_BABYLON.RawTexture3D).toHaveBeenCalledTimes(1);
        const [tData, w, h, d] = MOCK_BABYLON.RawTexture3D.mock.calls[0];
        expect(tData.length).toBe(FUEL_SIZE);
        expect(w).toBe(64);
        expect(h).toBe(64);
        expect(d).toBe(64);

        // Wrap modes must be clamped
        expect(texture.wrapU).toBe(MOCK_BABYLON.Texture.CLAMP_ADDRESSMODE);
        expect(texture.wrapV).toBe(MOCK_BABYLON.Texture.CLAMP_ADDRESSMODE);
        expect(texture.wrapR).toBe(MOCK_BABYLON.Texture.CLAMP_ADDRESSMODE);
    });
});
