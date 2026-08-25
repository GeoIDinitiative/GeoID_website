/**
 * STLLoader — minimal Three.js ES module loader for binary and ASCII STL.
 * FLIGHT-SIM copy: imports the Mars viewer's three.module.js so the geometry it
 * produces shares the same THREE instance the flight sim renders with.
 */
import * as THREE from '/planet_explorer/mars/viewer/vendor/three.module.js';

export class STLLoader extends THREE.Loader {
  load(url, onLoad, onProgress, onError) {
    const loader = new THREE.FileLoader(this.manager);
    loader.setResponseType('arraybuffer');
    loader.setRequestHeader(this.requestHeader);
    loader.setWithCredentials(this.withCredentials);
    loader.load(
      url,
      (buffer) => {
        try { onLoad(this.parse(buffer)); }
        catch (e) { onError ? onError(e) : console.error(e); }
      },
      onProgress,
      onError
    );
  }

  parse(buffer) {
    return this._isBinary(buffer) ? this._parseBinary(buffer) : this._parseASCII(new TextDecoder().decode(buffer));
  }

  _isBinary(buffer) {
    const dv = new DataView(buffer);
    if (buffer.byteLength < 84) return false;
    const numFaces = dv.getUint32(80, true);
    const expected = 84 + numFaces * 50;
    if (expected === buffer.byteLength) return true;
    // Fall back to inspecting the header for "solid" keyword
    const head = new Uint8Array(buffer, 0, 5);
    return !(head[0] === 115 && head[1] === 111 && head[2] === 108 && head[3] === 105 && head[4] === 100);
  }

  _parseBinary(buffer) {
    const dv = new DataView(buffer);
    const numFaces = dv.getUint32(80, true);
    const positions = new Float32Array(numFaces * 9);
    const normals = new Float32Array(numFaces * 9);
    let offset = 84;
    for (let i = 0; i < numFaces; i++) {
      const nx = dv.getFloat32(offset, true); offset += 4;
      const ny = dv.getFloat32(offset, true); offset += 4;
      const nz = dv.getFloat32(offset, true); offset += 4;
      for (let v = 0; v < 3; v++) {
        const base = i * 9 + v * 3;
        positions[base]     = dv.getFloat32(offset, true); offset += 4;
        positions[base + 1] = dv.getFloat32(offset, true); offset += 4;
        positions[base + 2] = dv.getFloat32(offset, true); offset += 4;
        normals[base] = nx; normals[base + 1] = ny; normals[base + 2] = nz;
      }
      offset += 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    return geo;
  }

  _parseASCII(text) {
    const positions = [];
    const normals = [];
    let faceNorm = [0, 0, 0];
    for (const line of text.split('\n')) {
      const l = line.trim();
      if (l.startsWith('facet normal')) {
        const m = l.match(/facet normal\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/);
        if (m) faceNorm = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
      } else if (l.startsWith('vertex')) {
        const m = l.match(/vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/);
        if (m) {
          positions.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
          normals.push(faceNorm[0], faceNorm[1], faceNorm[2]);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    return geo;
  }
}
