/**
 * fuel-volume-loader.js
 * Reusable module for loading raw volumetric data and creating Babylon.js RawTexture3D.
 * Works in both browser and Node.js (for tests).
 */

/**
 * Parse volume dimensions and scalar type from a raw volume filename.
 * Expected pattern: {name}_{width}x{height}x{depth}_{type}.raw
 * Example: fuel_64x64x64_uint8.raw
 *
 * @param {string} filename
 * @returns {{ name: string, dims: [number, number, number], type: string }}
 * @throws {Error} if the filename does not match the expected pattern
 */
function parseVolumeFilename(filename) {
    const match = filename.match(/^(\w+)_(\d+)x(\d+)x(\d+)_(\w+)\.raw$/);
    if (!match) {
        throw new Error(`Invalid volume filename: "${filename}". Expected pattern: name_WxHxD_type.raw`);
    }
    return {
        name: match[1],
        dims: [parseInt(match[2], 10), parseInt(match[3], 10), parseInt(match[4], 10)],
        type: match[5],
    };
}

/**
 * Load a raw uint8 volume file over HTTP using XMLHttpRequest.
 *
 * @param {string} url - Full URL to the .raw file
 * @param {function(number): void} [onProgress] - Optional callback with percent complete (0-100)
 * @returns {Promise<{ data: Uint8Array, dims: [number, number, number], type: string, name: string }>}
 */
function loadRawVolume(url, onProgress) {
    return new Promise((resolve, reject) => {
        // Parse filename from URL (strip query string)
        const rawFilename = url.split('/').pop().split('?')[0];
        let info;
        try {
            info = parseVolumeFilename(rawFilename);
        } catch (err) {
            return reject(err);
        }

        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';

        xhr.onprogress = (e) => {
            if (e.lengthComputable && typeof onProgress === 'function') {
                onProgress((e.loaded / e.total) * 100);
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                const data = new Uint8Array(xhr.response);
                const expectedSize = info.dims[0] * info.dims[1] * info.dims[2];
                if (data.length !== expectedSize) {
                    return reject(new Error(
                        `Data size mismatch: expected ${expectedSize} bytes for ` +
                        `${info.dims.join('x')} volume, got ${data.length}`
                    ));
                }
                resolve({ data, dims: info.dims, type: info.type, name: info.name });
            } else {
                reject(new Error(`HTTP error ${xhr.status} loading volume from ${url}`));
            }
        };

        xhr.onerror = () => reject(new Error(`Network error loading volume from ${url}`));
        xhr.send();
    });
}

/**
 * Create a Babylon.js RawTexture3D from raw uint8 volume data.
 *
 * @param {Uint8Array} data - Flat volume data (width * height * depth bytes)
 * @param {[number, number, number]} dims - [width, height, depth]
 * @param {object} scene - Babylon.js Scene instance
 * @param {object} BABYLON - Babylon.js namespace
 * @returns {object} Babylon.js RawTexture3D
 */
function createVolumeTexture(data, dims, scene, BABYLON) {
    const [width, height, depth] = dims;
    const texture = new BABYLON.RawTexture3D(
        data,
        width,
        height,
        depth,
        BABYLON.Engine.TEXTUREFORMAT_R,   // single red channel
        scene,
        false,                             // generateMipMaps
        false,                             // invertY
        BABYLON.Texture.BILINEAR_SAMPLINGMODE,
        BABYLON.Engine.TEXTURETYPE_UNSIGNED_BYTE
    );
    texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    texture.wrapR = BABYLON.Texture.CLAMP_ADDRESSMODE;
    return texture;
}

// CommonJS export for Node.js (tests); no-op in browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseVolumeFilename, loadRawVolume, createVolumeTexture };
}
