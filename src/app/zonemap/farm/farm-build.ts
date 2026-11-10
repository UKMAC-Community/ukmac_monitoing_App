import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { sectionPalette, type ZoneCell } from '../zone-layout';
import { bedRect, BLOCK_TAG_ROOM, blockTitle, PLOT_H, PLOT_W, plantStage, plotRect, type FarmBlock, type FarmPlace, type PlantStage } from './farm-scene';

/**
 * The farm built in 3D, as the system's Zone Map draws it (Staff_Attention_UI, zone-map/FarmCanvas/Farm3D/farm3dBuild.ts,
 * "an isometric farm illustration"): land in soft patches with tufts of grass; each zone block a sandy field edged in its
 * section's colour, with raised beds: tilled furrows where nothing's planted, rows of young plants, chilli bushes heavy
 * with red, recessed water, grey where not used. Low-poly and flat-shaded. World units as the layout's (x across, the
 * layout's y is z here, up is y). Everything that never changes merges into a few meshes (a draw call each); beds and
 * plants are instanced. Alive: plants, grass and leaves lean in the wind, leaves blow across, and the plants and grass
 * grow up when the view opens (`grow`, 0 to 1). The system's buildings, animals and fences aren't here: this app has
 * none.
 */

const DEG = Math.PI / 180;

/** Field, bed and water heights. */
const FIELD_TOP = 4;
const BED_H = 5;
export const BED_TOP = FIELD_TOP + BED_H;
const WATER_TOP = FIELD_TOP + 1.3;
/** The tallest thing, for fitting the view. */
const TALLEST = 30;

const COLOR = {
  bed: '#c99c6a',
  bedWet: '#a37650',
  chili: '#e5432f',
  field: '#ead7b1',
  furrow: '#b78656',
  grass: '#a3d47f',
  leaf: '#4f9e3f',
  rim: '#4ea6dc',
  sprout: '#7cc35f',
  unused: '#dcd8cd',
  water: '#69bdf0',
};

// ---- Pieces merged into one mesh -------------------------------------------

const scratchColor = new THREE.Color();

/** `geometry` placed by `matrix`, painted `color` on every vertex (one shape of a merged mesh). */
function painted(geometry: THREE.BufferGeometry, color: string, matrix: THREE.Matrix4) {
  const piece = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  piece.applyMatrix4(matrix);
  piece.clearGroups();
  if (piece.getAttribute('uv')) piece.deleteAttribute('uv');
  scratchColor.set(color);
  const count = piece.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = scratchColor.r;
    colors[index * 3 + 1] = scratchColor.g;
    colors[index * 3 + 2] = scratchColor.b;
  }
  piece.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return piece;
}

class Pieces {
  private parts: THREE.BufferGeometry[] = [];

  add(geometry: THREE.BufferGeometry, color: string, matrix: THREE.Matrix4) {
    this.parts.push(painted(geometry, color, matrix));
  }

  /** All of it as one mesh (null when there's nothing). */
  mesh(material: THREE.Material) {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const part of this.parts) part.dispose();
    this.parts = [];
    return merged ? new THREE.Mesh(merged, material) : null;
  }
}

// ---- Wind -----------------------------------------------------------------

/**
 * Each vertex leans downwind by how high it stands over the ground, in waves rolling across the farm and gusts coming
 * and going; and each instance grows up from the ground (`uGrow`, 0 to 1), one after another by where it stands.
 */
const WIND_VERTEX = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
float growK = 1.0;
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  float growSeed = fract( sin( dot( instanceMatrix[3].xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  growK = clamp( uGrow * 1.7 - growSeed * 0.7, 0.0, 1.0 );
  growK = growK * growK * ( 3.0 - 2.0 * growK );
#endif
mvPosition.y = uWindGround + ( mvPosition.y - uWindGround ) * growK;
vec4 windAt = modelMatrix * mvPosition;
float windWave = uWindTime * 1.8 - dot( windAt.xz, vec2( 0.012, 0.007 ) );
float windGust = 0.55 + 0.45 * sin( uWindTime * 0.33 - windAt.x * 0.0021 );
float windLean = ( 0.35 + 0.45 * sin( windWave ) + 0.2 * sin( windWave * 2.6 + 1.3 ) ) * windGust;
windAt.xz += vec2( 0.83, 0.55 ) * windLean * max( windAt.y - uWindGround, 0.0 ) * uWindBend * growK;
mvPosition = viewMatrix * windAt;
gl_Position = projectionMatrix * mvPosition;
`;

/** `material`, leaning in the wind (`time` in seconds) and growing up (`grow`): `bend` a unit up over `ground`. */
function windy<M extends THREE.MeshStandardMaterial>(material: M, time: { value: number }, grow: { value: number }, bend: number, ground: number): M {
  material.onBeforeCompile = (shader) => {
    shader.uniforms['uWindTime'] = time;
    shader.uniforms['uGrow'] = grow;
    shader.uniforms['uWindBend'] = { value: bend };
    shader.uniforms['uWindGround'] = { value: ground };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;\nuniform float uGrow;\nuniform float uWindBend;\nuniform float uWindGround;')
      .replace('#include <project_vertex>', WIND_VERTEX);
  };
  material.customProgramCacheKey = () => 'farm-wind-grow';
  return material;
}

/** The land past the farm: grass in soft patches, lighter and darker. */
function landMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: COLOR.grass, metalness: 0, roughness: 1 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLand;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLand = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
varying vec2 vLand;
float landHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
float landNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( landHash( i ), landHash( i + vec2( 1.0, 0.0 ) ), u.x ),
    mix( landHash( i + vec2( 0.0, 1.0 ) ), landHash( i + vec2( 1.0, 1.0 ) ), u.x ),
    u.y
  );
}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
float landPatch = landNoise( vLand * 0.004 ) * 0.65 + landNoise( vLand * 0.017 ) * 0.35;
diffuseColor.rgb *= 0.9 + landPatch * 0.18;`,
      );
  };
  material.customProgramCacheKey = () => 'farm-land';
  return material;
}

// Unit shapes, sized and placed by each piece's matrix.
const SHAPES = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(1, 1, 7),
  ico: new THREE.IcosahedronGeometry(1, 0),
};

const scratch = {
  euler: new THREE.Euler(),
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
};

/** A matrix: at (x, y, z), sized (sx, sy, sz), turned about y (then x, z), in radians. */
function at(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, turnY = 0, turnX = 0, turnZ = 0) {
  scratch.euler.set(turnX, turnY, turnZ, 'YXZ');
  scratch.quaternion.setFromEuler(scratch.euler);
  return new THREE.Matrix4().compose(scratch.position.set(x, y, z), scratch.quaternion, scratch.scale.set(sx, sy, sz));
}

/** A seeded random, so the farm is the same every time it's built. */
function seeded(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `target` set to (x, y, z), turned `turnY` then tipped `turnZ`, sized (sx, sy, sz): no new objects, for every frame. */
const pose = { euler: new THREE.Euler(), local: new THREE.Matrix4(), position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3() };
function placed(target: THREE.Matrix4, [x, y, z]: [number, number, number], [sx, sy, sz]: [number, number, number], turnY: number, turnZ = 0) {
  pose.euler.set(0, turnY, turnZ, 'YXZ');
  pose.quaternion.setFromEuler(pose.euler);
  return target.compose(pose.position.set(x, y, z), pose.quaternion, pose.scale.set(sx, sy, sz));
}

/** The wind's way across the farm (x, z). */
const WIND = { x: 0.83, z: 0.55 };

// ---- The farm --------------------------------------------------------------

/** A zone block's tag over the farm. */
export interface FarmLabel {
  /** Where it floats over the farm. */
  anchor: [number, number, number];
  /** Its section's colours. */
  border: string;
  color: string;
  key: string;
  text: string;
}

/** How a bed looks: its soil, and what grows on it. */
export type BedState = 'unused' | 'soil' | NonNullable<PlantStage>;

export function bedState(cell: ZoneCell): BedState {
  if (cell.usage === 'unused') return 'unused';
  return plantStage(cell) ?? 'soil';
}

export interface FarmBuilt {
  /** The farm as it is at `seconds`: the plants leaning, the leaves blown on. */
  animate: (seconds: number) => void;
  /** The plants and grass growing up: 0 (not yet) to 1; the view moves it as it opens. */
  grow: { value: number };
  /** The land past the farm, one unit square: kept under the view and as big as it is, so it never ends. */
  land: THREE.Mesh;
  group: THREE.Group;
  /** Every bed, one instance each, for finding what's tapped. */
  beds: THREE.InstancedMesh | null;
  bedCells: ZoneCell[];
  /** Each plot's bed, by its id: its middle on top, and how big it is. */
  bedTops: Map<string, THREE.Vector3>;
  bedSizes: Map<string, { h: number; w: number }>;
  /** The ground's extent, and the tallest thing on it. */
  bounds: { maxX: number; maxY: number; maxZ: number; minX: number; minZ: number };
  /** Everything on it, without the ground's margin. */
  content: { maxX: number; maxZ: number; minX: number; minZ: number };
  labels: FarmLabel[];
  /** What's on the farm, for the test and the count. */
  stats: { beds: number; byState: Record<BedState, number>; plants: number };
  dispose: () => void;
}

/** The whole farm as 3D objects (see the top of the file). */
export function buildFarm(blocks: FarmBlock[], places: Record<string, FarmPlace>): FarmBuilt {
  const buckets = { solid: new Pieces(), water: new Pieces() };
  const windTime = { value: 0 };
  const grow = { value: 1 };
  const group = new THREE.Group();
  const random = seeded('farm');

  // The ground's extent: everything on it, and a margin of grass.
  const boxes = blocks
    .filter((block) => places[block.id])
    .map((block) => ({ h: block.h + BLOCK_TAG_ROOM, w: block.w, x: places[block.id].x, y: places[block.id].y - BLOCK_TAG_ROOM }));
  const margin = 70;
  const minX = Math.min(...boxes.map((box) => box.x), 0) - margin;
  const minZ = Math.min(...boxes.map((box) => box.y), 0) - margin;
  const maxX = Math.max(...boxes.map((box) => box.x + box.w), 0) + margin;
  const maxZ = Math.max(...boxes.map((box) => box.y + box.h), 0) + margin;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const middleX = (minX + maxX) / 2;
  const middleZ = (minZ + maxZ) / 2;

  const land = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), landMaterial());
  land.position.set(middleX, 0, middleZ);
  land.scale.set(width * 6, 1, depth * 6);
  land.receiveShadow = true;
  group.add(land);

  // The zone blocks: a sandy field edged in the section's colour.
  interface Bed {
    cell: ZoneCell;
    h: number;
    state: BedState;
    w: number;
    x: number;
    z: number;
  }
  const beds: Bed[] = [];
  const waterRims: [number, number, number, number][] = [];
  const labels: FarmLabel[] = [];
  for (const block of blocks) {
    const place = places[block.id];
    if (!place) continue;
    const palette = sectionPalette(block.section.section);
    const fields = block.geo?.fields ?? [{ h: block.h, w: block.w, x: 0, y: 0 }];
    for (const field of fields) {
      const cx = place.x + field.x + field.w / 2;
      const cz = place.y + field.y + field.h / 2;
      buckets.solid.add(SHAPES.box, palette.border, at(cx, 1.6, cz, field.w + 8, 3.2, field.h + 8));
      buckets.solid.add(SHAPES.box, COLOR.field, at(cx, FIELD_TOP / 2, cz, field.w, FIELD_TOP, field.h));
    }
    for (const cell of block.section.cells) {
      if (cell.usage === 'water') {
        // Water cells are drawn only on a block laid out by its rows and columns (not by the satellite), sunk below the beds.
        if (block.geo) continue;
        const rect = plotRect(cell);
        const x = place.x + rect.x + rect.w / 2;
        const z = place.y + rect.y + rect.h / 2;
        waterRims.push([x, z, rect.w + 3, rect.h + 3]);
        buckets.water.add(SHAPES.box, COLOR.water, at(x, WATER_TOP - 0.4, z, rect.w, 0.8, rect.h));
        continue;
      }
      const rect = bedRect(block, cell);
      beds.push({ cell, h: rect.h, state: bedState(cell), w: rect.w, x: place.x + rect.x + rect.w / 2, z: place.y + rect.y + rect.h / 2 });
    }
    labels.push({
      anchor: [place.x + 4, BED_TOP + 4, place.y - 4],
      border: palette.border,
      color: palette.text,
      key: `block-${block.id}`,
      text: blockTitle(block),
    });
  }
  for (const [x, z, w, d] of waterRims) buckets.water.add(SHAPES.box, COLOR.rim, at(x, WATER_TOP - 0.7, z, w, 0.6, d));

  const solidMaterial = new THREE.MeshStandardMaterial({ flatShading: true, metalness: 0, roughness: 0.92, vertexColors: true });
  const waterMaterial = new THREE.MeshStandardMaterial({ metalness: 0.05, roughness: 0.22, vertexColors: true });
  const solid = buckets.solid.mesh(solidMaterial);
  const water = buckets.water.mesh(waterMaterial);
  if (solid) {
    solid.castShadow = true;
    solid.receiveShadow = true;
    group.add(solid);
  }
  if (water) {
    water.receiveShadow = true;
    group.add(water);
  }

  // The beds, one instance each, tinted by what's on them.
  const bedTops = new Map<string, THREE.Vector3>();
  const bedSizes = new Map<string, { h: number; w: number }>();
  let bedMesh: THREE.InstancedMesh | null = null;
  const owned: (THREE.BufferGeometry | THREE.Material)[] = [solidMaterial, waterMaterial, land.geometry, land.material as THREE.Material];
  const instances: THREE.InstancedMesh[] = [];
  const byState: Record<BedState, number> = { harvest: 0, planting: 0, soil: 0, unused: 0 };
  let plants = 0;
  if (beds.length) {
    // One unit across, each bed stretched to its own size.
    const geometry = new THREE.BoxGeometry(1, BED_H, 1);
    const material = new THREE.MeshStandardMaterial({ roughness: 1 });
    owned.push(geometry, material);
    bedMesh = new THREE.InstancedMesh(geometry, material, beds.length);
    beds.forEach((bed, index) => {
      bedMesh!.setMatrixAt(index, at(bed.x, FIELD_TOP + BED_H / 2, bed.z, bed.w - 2, 1, bed.h - 2));
      scratchColor.set(bed.state === 'unused' ? COLOR.unused : bed.state === 'soil' ? COLOR.bed : COLOR.bedWet);
      bedMesh!.setColorAt(index, scratchColor);
      byState[bed.state] += 1;
      bedTops.set(bed.cell.id, new THREE.Vector3(bed.x, BED_TOP, bed.z));
      if (bed.w !== PLOT_W || bed.h !== PLOT_H) bedSizes.set(bed.cell.id, { h: bed.h, w: bed.w });
    });
    bedMesh.castShadow = true;
    bedMesh.receiveShadow = true;
    instances.push(bedMesh);
    group.add(bedMesh);

    // What grows on them.
    const furrows: THREE.Matrix4[] = [];
    const sprouts: THREE.Matrix4[] = [];
    const bushes: THREE.Matrix4[] = [];
    const chilies: THREE.Matrix4[] = [];
    for (const bed of beds) {
      // Three furrows and three rows of four plants a cell.
      const lines = 3;
      const across = 4;
      if (bed.state === 'soil') {
        for (let line = 0; line < lines; line += 1) {
          furrows.push(at(bed.x, BED_TOP + 0.7, bed.z + (line - (lines - 1) / 2) * ((bed.h - 18) / (lines - 1)), bed.w - 10, 1.4, 3.2));
        }
      }
      if (bed.state !== 'planting' && bed.state !== 'harvest') continue;
      for (let row = 0; row < lines; row += 1) {
        for (let column = 0; column < across; column += 1) {
          const x = bed.x - bed.w / 2 + (bed.w * (column + 0.5)) / across + (random() - 0.5) * 2;
          const z = bed.z - bed.h / 2 + (bed.h * (row + 0.5)) / lines + (random() - 0.5) * 2;
          plants += 1;
          if (bed.state === 'planting') {
            const size = 0.85 + random() * 0.3;
            sprouts.push(at(x, BED_TOP + 3.5 * size, z, 3 * size, 7 * size, 3 * size, random() * 3));
          } else {
            const size = 0.9 + random() * 0.25;
            bushes.push(at(x, BED_TOP + 4.2 * size, z, 4.8 * size, 4.4 * size, 4.8 * size, random() * 3));
            for (let fruit = 0; fruit < 3; fruit += 1) {
              const angle = random() * Math.PI * 2;
              chilies.push(at(x + Math.cos(angle) * 4, BED_TOP + 3 + random() * 4, z + Math.sin(angle) * 4, 1.4, 3.2, 1.4, angle, 0, 0.35));
            }
          }
        }
      }
    }
    const instanced = (shape: THREE.BufferGeometry, color: string, matrices: THREE.Matrix4[], bend = 0) => {
      if (!matrices.length) return;
      const plain = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 });
      const material = bend ? windy(plain, windTime, grow, bend, BED_TOP) : plain;
      owned.push(material);
      const mesh = new THREE.InstancedMesh(shape, material, matrices.length);
      matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.receiveShadow = true;
      instances.push(mesh);
      group.add(mesh);
    };
    instanced(SHAPES.box, COLOR.furrow, furrows);
    instanced(SHAPES.cone, COLOR.sprout, sprouts, 0.13);
    instanced(SHAPES.ico, COLOR.leaf, bushes, 0.11);
    instanced(SHAPES.box, COLOR.chili, chilies, 0.11);
  }

  // Tufts of grass over the land, clear of everything on it.
  const grassBlades: THREE.Matrix4[] = [];
  const grassColors: string[] = [];
  {
    const reach = 900;
    const fromX = minX - reach;
    const fromZ = minZ - reach;
    const spanX = width + reach * 2;
    const spanZ = depth + reach * 2;
    const clear = (x: number, z: number) => !boxes.some((box) => x > box.x - 10 && x < box.x + box.w + 10 && z > box.y - 10 && z < box.y + box.h + 10);
    const tufts = Math.min(1200, Math.round((spanX * spanZ) / 2600));
    const greens = ['#86c264', '#79b85a', '#94cc6c'];
    for (let tuft = 0; tuft < tufts; tuft += 1) {
      const x = fromX + random() * spanX;
      const z = fromZ + random() * spanZ;
      if (!clear(x, z)) continue;
      const color = greens[Math.floor(random() * greens.length)];
      for (let blade = 0; blade < 3; blade += 1) {
        const tall = 4 + random() * 3.5;
        grassBlades.push(at(x + (random() - 0.5) * 4, tall / 2, z + (random() - 0.5) * 4, 1.2, tall, 1.2, random() * 3, (random() - 0.5) * 0.5));
        grassColors.push(color);
      }
    }
  }
  if (grassBlades.length) {
    const material = windy(new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 }), windTime, grow, 0.16, 0);
    owned.push(material);
    const grass = new THREE.InstancedMesh(SHAPES.cone, material, grassBlades.length);
    grassBlades.forEach((matrix, index) => {
      grass.setMatrixAt(index, matrix);
      grass.setColorAt(index, scratchColor.set(grassColors[index]));
    });
    grass.receiveShadow = true;
    instances.push(grass);
    group.add(grass);
  }

  // Leaves blown across the farm, low over it.
  const blowing: { across: number; along: number; high: number; phase: number; speed: number }[] = [];
  const windLength = Math.abs(width * WIND.x) + Math.abs(depth * WIND.z) + 200;
  const windWidth = Math.abs(width * WIND.z) + Math.abs(depth * WIND.x) + 200;
  const leafCount = Math.round(Math.min(48, Math.max(18, (width * depth) / 45000)));
  let leafMesh: THREE.InstancedMesh | null = null;
  {
    const material = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.8, side: THREE.DoubleSide });
    owned.push(material);
    leafMesh = new THREE.InstancedMesh(SHAPES.ico, material, leafCount);
    const tints = ['#6fb24f', '#8cc152', '#c9b43c', '#e0a33a', '#5d9e44'];
    for (let leaf = 0; leaf < leafCount; leaf += 1) {
      blowing.push({ across: (random() - 0.5) * windWidth, along: random() * windLength, high: 14 + random() * 30, phase: random() * Math.PI * 2, speed: 38 + random() * 34 });
      leafMesh.setColorAt(leaf, scratchColor.set(tints[Math.floor(random() * tints.length)]));
    }
    leafMesh.frustumCulled = false;
    instances.push(leafMesh);
    group.add(leafMesh);
  }

  const scratchMatrix = new THREE.Matrix4();
  const animate = (seconds: number) => {
    windTime.value = seconds;
    blowing.forEach((leaf, index) => {
      // Along the wind, round again past the far side; small at each end so none pops in or out.
      const along = (((leaf.along + leaf.speed * seconds) % windLength) + windLength) % windLength;
      const ends = Math.min(along, windLength - along) / 80;
      const flutter = Math.sin(seconds * 2.3 + leaf.phase);
      const x = middleX + WIND.x * (along - windLength / 2) - WIND.z * (leaf.across + flutter * 10);
      const z = middleZ + WIND.z * (along - windLength / 2) + WIND.x * (leaf.across + flutter * 10);
      const size = Math.max(0, Math.min(1, ends));
      placed(scratchMatrix, [x, leaf.high + Math.sin(seconds * 1.4 + leaf.phase) * 6, z], [5 * size, 0.7 * size, 2.8 * size], seconds * 2.1 + leaf.phase, Math.sin(seconds * 3.1 + leaf.phase) * 1.2);
      leafMesh!.setMatrixAt(index, scratchMatrix);
    });
    leafMesh!.instanceMatrix.needsUpdate = true;
  };
  animate(0);

  return {
    animate,
    beds: bedMesh,
    bedCells: beds.map((bed) => bed.cell),
    bedSizes,
    bedTops,
    bounds: { maxX, maxY: TALLEST, maxZ, minX, minZ },
    content: { maxX: maxX - margin, maxZ: maxZ - margin, minX: minX + margin, minZ: minZ + margin },
    dispose: () => {
      for (const mesh of [solid, water]) mesh?.geometry.dispose();
      for (const mesh of instances) mesh.dispose();
      for (const thing of owned) thing.dispose();
    },
    grow,
    group,
    labels,
    land,
    stats: { beds: beds.length, byState, plants },
  };
}

export { DEG };
