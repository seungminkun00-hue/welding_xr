import * as THREE from 'three';

// Procedural PBR steel. Every map is generated at runtime from a seeded noise
// field, so the simulator still ships zero texture files and still works with
// no network -- the same constraint that put three.js in vendor/.
//
// The maps are deliberately derived from the SAME few noise fields. On real
// steel a mill-scale patch is simultaneously darker, rougher AND less
// reflective, and a grinding mark is simultaneously a groove and a bright
// streak. Driving albedo / roughness / metalness / normal from independent
// noise is the main reason procedural metal reads as grey plastic.

// --- seeded, tileable value noise ------------------------------------------

function hash(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Periods are integers and double every octave, so the result tiles seamlessly.
function noise(x, y, periodX, periodY, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const ax = ((x0 % periodX) + periodX) % periodX;
  const ay = ((y0 % periodY) + periodY) % periodY;
  const bx = (ax + 1) % periodX, by = (ay + 1) % periodY;
  const n00 = hash(ax, ay, seed), n10 = hash(bx, ay, seed);
  const n01 = hash(ax, by, seed), n11 = hash(bx, by, seed);
  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
}

// Separate x/y frequencies are what make anisotropy possible: a high v
// frequency against a low u frequency gives streaks running along u, which is
// how rolled and ground steel actually looks.
function fbm(u, v, freqX, freqY, octaves, seed, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, fx = freqX, fy = freqY;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(u * fx, v * fy, fx, fy, seed + o * 101);
    norm += amp;
    amp *= gain;
    fx *= 2; fy *= 2;
  }
  return sum / norm;
}

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;

function smoothstep(edge0, edge1, v) {
  const t = clamp01((v - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

// fbm clusters around 0.5; expand it so thresholds have something to bite on.
const contrast = (v, k) => clamp01((v - 0.5) * k + 0.5);

// --- surface presets --------------------------------------------------------
// Colours are authored sRGB 0..1 and are mixed in sRGB, the way hand-painted
// texture sets behave.

const PRESETS = {
  // Cold-rolled stainless sheet, 2B finish: what most people picture when they
  // say "steel". Base colour sits near sRGB 0.80 because polished stainless
  // reflects almost everything; the surface is a soft mirror whose only
  // features are cloudy polishing smudges. No pitting, almost no relief --
  // every bump added here is one more thing stopping it reading as metal.
  rolledSheet: {
    bare: [0.805, 0.810, 0.815], oxide: [0.700, 0.706, 0.714],
    oxideCover: 0.42, oxidePatchFreq: 5,
    roughBare: 0.16, roughOxide: 0.31,
    metalBare: 1.0, metalOxide: 0.96,
    streakFreq: [2, 14], streakDepth: 0.07,
    grind: 0.22, grindFreq: [2, 300],
    pits: 0.0, relief: 0.16,
  },
  // Drawn and polished tube. Rougher only where the polish skipped, which is
  // what gives the long unbroken highlight running the length of a pipe.
  polishedTube: {
    bare: [0.830, 0.835, 0.842], oxide: [0.762, 0.768, 0.776],
    oxideCover: 0.10, oxidePatchFreq: 6,
    roughBare: 0.085, roughOxide: 0.165,
    metalBare: 1.0, metalOxide: 0.985,
    streakFreq: [2, 18], streakDepth: 0.025,
    grind: 0.26, grindFreq: [2, 520],
    pits: 0.0, relief: 0.09,
  },
  // Mill finish straight off the rolling line: blue-grey oxide over steel.
  hotRolledPlate: {
    bare: [0.545, 0.555, 0.575], oxide: [0.295, 0.305, 0.335],
    oxideCover: 0.64, oxidePatchFreq: 9,
    roughBare: 0.31, roughOxide: 0.72,
    metalBare: 0.96, metalOxide: 0.72,
    streakFreq: [2, 22], streakDepth: 0.18,
    grind: 0.0, grindFreq: [2, 180],
    pits: 0.55, relief: 1.0,
  },
  // Pipe wire-brushed or flap-disced before welding: brighter, strongly
  // anisotropic, oxide only surviving in the low spots.
  groundPipe: {
    bare: [0.705, 0.715, 0.735], oxide: [0.60, 0.615, 0.635],
    oxideCover: 0.08, oxidePatchFreq: 12,
    roughBare: 0.16, roughOxide: 0.32,
    metalBare: 0.98, metalOxide: 0.92,
    streakFreq: [2, 30], streakDepth: 0.05,
    grind: 0.40, grindFreq: [2, 420],
    pits: 0.06, relief: 0.22,
  },
  // Freshly cut or bevelled face: bare, no oxide, coarse directional tool marks.
  cutEdge: {
    bare: [0.800, 0.802, 0.806], oxide: [0.690, 0.686, 0.680],
    oxideCover: 0.1, oxidePatchFreq: 14,
    roughBare: 0.26, roughOxide: 0.40,
    metalBare: 0.95, metalOxide: 0.88,
    streakFreq: [2, 90], streakDepth: 0.55,
    grind: 0.55, grindFreq: [2, 120],
    pits: 0.25, relief: 0.75,
  },
  // Bench top: same steel, beaten up by years of work.
  benchSteel: {
    bare: [0.47, 0.48, 0.49], oxide: [0.335, 0.34, 0.345],
    oxideCover: 0.5, oxidePatchFreq: 16,
    roughBare: 0.46, roughOxide: 0.88,
    metalBare: 0.88, metalOxide: 0.52,
    streakFreq: [3, 16], streakDepth: 0.22,
    grind: 0.35, grindFreq: [4, 150],
    pits: 0.7, relief: 0.7,
  },
};

function dataTexture(bytes, size, { srgb }) {
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// --- generation -------------------------------------------------------------

function generate(name, size, seed) {
  const p = PRESETS[name];
  const count = size * size;
  const height = new Float32Array(count);
  const oxideAt = new Float32Array(count);
  const grindAt = new Float32Array(count);
  const pitAt = new Float32Array(count);

  // Pass 1: the height field, plus the masks the other maps read back so every
  // map agrees about where the oxide and the scratches are.
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size;

      // Oxide survives in broad patches with a hard-ish edge where it flaked.
      const patch = contrast(fbm(u, v, p.oxidePatchFreq, p.oxidePatchFreq, 6, seed + 11), 1.35);
      const oxide = smoothstep(0.34, 0.68, patch + (p.oxideCover - 0.5) * 0.7);

      // Rolling direction: long shallow waves running along u.
      const streak = fbm(u, v, p.streakFreq[0], p.streakFreq[1], 3, seed + 23) - 0.5;

      // Abrasive marks: very thin, very directional, sharpened into lines.
      let grind = 0;
      if (p.grind > 0) {
        const g = Math.abs(fbm(u, v, p.grindFreq[0], p.grindFreq[1], 2, seed + 37) - 0.5);
        grind = g < 0.085 ? p.grind * (1 - g / 0.085) : 0;
      }

      // Micro pitting and casting porosity.
      const pit = p.pits * smoothstep(0.80, 0.99, fbm(u, v, 160, 160, 2, seed + 53));

      oxideAt[i] = oxide;
      grindAt[i] = grind;
      pitAt[i] = pit;
      height[i] = p.relief * (
        streak * p.streakDepth
        + oxide * 0.05 * (fbm(u, v, 24, 24, 2, seed + 67) - 0.5)
        - grind * 0.45
        - pit * 0.38
      );
    }
  }

  // Pass 2: colour and PBR maps, read straight off the pass 1 masks.
  const albedo = new Uint8Array(count * 4);
  const rough = new Uint8Array(count * 4);
  const metal = new Uint8Array(count * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4;
      const oxide = oxideAt[i], grind = grindAt[i], pit = pitAt[i];

      // Grinding cuts through to bright bare metal; pits hold dirt and read as
      // cavity occlusion, which is baked in here rather than shipped as an
      // aoMap (that would need a uv1 channel on every workpiece geometry).
      const bareness = clamp01(1 - oxide + grind * 0.9);
      const cavity = 1 - pit * 0.20;
      const grain = 0.94 + 0.12 * fbm(x / size, v, 64, 64, 2, seed + 71);
      for (let c = 0; c < 3; c++) {
        albedo[o + c] = clamp01(mix(p.oxide[c], p.bare[c], bareness) * cavity * grain) * 255;
      }
      albedo[o + 3] = 255;

      // Oxide dulls, abrasion polishes, pits scatter.
      const r = clamp01(mix(p.roughOxide, p.roughBare, bareness) - grind * 0.14 + pit * 0.13);
      rough[o] = rough[o + 1] = rough[o + 2] = r * 255;
      rough[o + 3] = 255;

      // Oxide is a dielectric film, so reflectivity drops wherever it survives.
      const m = clamp01(mix(p.metalOxide, p.metalBare, bareness));
      metal[o] = metal[o + 1] = metal[o + 2] = m * 255;
      metal[o + 3] = 255;
    }
  }

  // Pass 3: normals by Sobel on the height field. Sampling wraps, so the normal
  // map tiles as seamlessly as the colour does.
  const normal = new Uint8Array(count * 4);
  const strength = size / 22;
  for (let y = 0; y < size; y++) {
    const row = y * size;
    const yp = ((y + 1) % size) * size, yn = ((y - 1 + size) % size) * size;
    for (let x = 0; x < size; x++) {
      const o = (row + x) * 4;
      const xp = (x + 1) % size, xn = (x - 1 + size) % size;
      const dx = (height[row + xp] - height[row + xn]) * 0.5;
      const dy = (height[yp + x] - height[yn + x]) * 0.5;
      // Image rows run downward while tangent-space +Y runs up, so dy keeps its
      // sign and dx is negated: an OpenGL-convention map, which is what
      // MeshStandardMaterial expects.
      const nx = -dx * strength, ny = dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      normal[o] = (nx / len * 0.5 + 0.5) * 255;
      normal[o + 1] = (ny / len * 0.5 + 0.5) * 255;
      normal[o + 2] = (nz / len * 0.5 + 0.5) * 255;
      normal[o + 3] = 255;
    }
  }

  return {
    map: dataTexture(albedo, size, { srgb: true }),
    normalMap: dataTexture(normal, size, { srgb: false }),
    roughnessMap: dataTexture(rough, size, { srgb: false }),
    metalnessMap: dataTexture(metal, size, { srgb: false }),
  };
}

// Generation costs a few hundred ms at 1024, so each preset is built once and
// its textures are shared by every material that asks for it.
const cache = new Map();

export function steelTextures(name = 'hotRolledPlate', { size = 1024, seed = 1337 } = {}) {
  const key = `${name}:${size}:${seed}`;
  if (!cache.has(key)) cache.set(key, generate(name, size, seed));
  return cache.get(key);
}

/**
 * Steel material whose texel density is set in metres rather than UV repeats,
 * so a 12 mm plate and a 60 mm pipe end up with grain of the same real size.
 *
 * @param {string} preset   key of PRESETS
 * @param {number[]} span   [u, v] extent of the mapped face, in metres
 * @param {number} tile     metres covered by one texture repeat
 * @param {THREE.WebGLRenderer} [renderer]  enables anisotropic filtering
 */
export function steelMaterialPBR(preset = 'hotRolledPlate', {
  span = [0.13, 0.34], tile = 0.11, size = 1024, seed = 1337,
  normalScale = 1.0, tint = null, renderer = null,
} = {}) {
  const shared = steelTextures(preset, { size, seed });
  const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 4;

  // repeat and anisotropy live on the texture, not the material, so each
  // material gets clones. Clones share the GPU upload, not the sampler state.
  const maps = {};
  for (const [slot, texture] of Object.entries(shared)) {
    const copy = texture.clone();
    copy.repeat.set(Math.max(span[0] / tile, 0.25), Math.max(span[1] / tile, 0.25));
    // Steel is nearly always seen at a grazing angle in VR. Without this the
    // grain smears into flat grey two thirds of the way down the plate.
    copy.anisotropy = Math.min(8, maxAniso);
    copy.needsUpdate = true;
    maps[slot] = copy;
  }

  return new THREE.MeshStandardMaterial({
    ...maps,
    color: tint ?? 0xffffff,
    // roughness and metalness multiply their maps, so they stay at 1.
    roughness: 1,
    metalness: 1,
    normalScale: new THREE.Vector2(normalScale, normalScale),
    envMapIntensity: 1.6,
  });
}

export { PRESETS };
