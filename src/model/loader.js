// STL file reading (binary and ASCII).
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

const loader = new STLLoader();

export const isSTL = file => /\.stl$/i.test(file.name);

/** Parse an STL File into a BufferGeometry. Throws on unreadable data. */
export async function readSTL(file) {
  return loader.parse(await file.arrayBuffer());
}
