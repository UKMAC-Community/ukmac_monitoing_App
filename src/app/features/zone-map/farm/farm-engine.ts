import * as THREE from 'three';

import type { FarmBuilt, FarmLabel } from './farm-build';
import { PLOT_H, PLOT_W } from './farm-scene';

/**
 * The 3D farm's camera, light and hands (Staff_Attention_UI, zone-map/FarmCanvas/Farm3D/farm3dEngine.ts, without its focus,
 * tour and weather): an orthographic camera that starts looking straight down and tips back into the isometric view as
 * the farm opens (the plants and grass growing up as it does); drag to look around, scroll or pinch to zoom (about the
 * pointer), shift- or right-drag to turn it; a bed under the pointer lifts a pale slab and names itself, a tap picks it.
 * The zone tags float over it. It draws every frame while it's on screen (the wind never stops), none when it isn't;
 * with the Mac asking for less motion it holds still and draws only when something changes.
 */

const DEG = Math.PI / 180;
const ISO_AZIMUTH = Math.PI / 4;
const ISO_ELEVATION = 33 * DEG;
const TOP_ELEVATION = Math.PI / 2;
/** The tilt from the top view into the isometric one, and how long the plants take to grow up after it begins. */
const TILT_MS = 1100;
const GROW_MS = 2400;
const GROW_WAIT_MS = 250;
const MIN_K = 0.08;
const MAX_K = 3;
const FIT_MAX_K = 2.4;
/** A pointer moved less than this (px) between down and up is a tap. */
const TAP_SLOP = 4;
/** Clear room round the farm when it's fitted: its sides, the tags over it, the legend and zoom under it (px). */
const SIDE = 20;
const TOP_ROOM = 52;
const BOTTOM_ROOM = 84;
/** Tags show once the farm is big enough on screen to read them. */
const TAG_MIN_K = 0.2;
/** The sun, from the west and high: its shadows fall to the right of the view. */
const SUN_FROM = new THREE.Vector3(-0.62, 1, 0.22).normalize();
/** A clear day. */
const LIGHT = { ground: '#c9dcb8', sky: '#ffffff', skyIntensity: 1.65, sun: '#fff4e2', sunIntensity: 2.1 };

interface Pose {
  azimuth: number;
  elevation: number;
  k: number;
  tx: number;
  tz: number;
}

export interface FarmEngineEvents {
  /** The zoom changed (1 is 100%). */
  onZoom: (k: number) => void;
  /** A bed tapped (its plot's id), or the ground. */
  onPick: (id: string | null) => void;
  /** A bed under the pointer (and where, in the host's px), or none. */
  onHover: (id: string | null, x: number, y: number) => void;
  /** The first frame is drawn. */
  onFirstFrame: () => void;
}

/** How far a box on the ground, things on it up to `maxY` tall, reaches across the screen and up it, turned `a` and tilted `e`. */
function extent(box: { maxX: number; maxZ: number; minX: number; minZ: number }, maxY: number, a: number, e: number) {
  const right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
  const up = new THREE.Vector3(-Math.sin(e) * Math.sin(a), Math.cos(e), -Math.sin(e) * Math.cos(a));
  let left = Infinity;
  let rightmost = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  const corner = new THREE.Vector3();
  for (const x of [box.minX, box.maxX]) {
    for (const y of [0, maxY]) {
      for (const z of [box.minZ, box.maxZ]) {
        corner.set(x, y, z);
        const sx = corner.dot(right);
        const sy = corner.dot(up);
        left = Math.min(left, sx);
        rightmost = Math.max(rightmost, sx);
        bottom = Math.min(bottom, sy);
        top = Math.max(top, sy);
      }
    }
  }
  return { bottom, left, right: rightmost, top };
}

const ease = (t: number) => t * t * (3 - 2 * t);

export class FarmEngine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly sun: THREE.DirectionalLight;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hover: THREE.Mesh;
  private readonly active: THREE.Group;
  private readonly owned: { dispose: () => void }[] = [];
  private readonly reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  private readonly observer: ResizeObserver;
  private readonly onScreen: IntersectionObserver;

  private farm: FarmBuilt | null = null;
  private labels: { element: HTMLElement; anchor: THREE.Vector3 }[] = [];
  private size = { height: 1, width: 1 };
  private pose: Pose = { azimuth: 0, elevation: TOP_ELEVATION, k: 1, tx: 0, tz: 0 };
  private distance = 2500;
  /** The moves run by the frames drawn, each counted as 64 ms at most, so a frame that stalls (the shaders compiling) doesn't skip a move. */
  private animation: { duration: number; elapsed: number; from: Pose; to: Pose } | null = null;
  /** How long the farm has been opening (ms): the plants grow up by it. Null until a farm's been shown. */
  private opening: number | null = null;
  private last = 0;
  private touched = false;
  private frame = 0;
  private visible = true;
  private disposed = false;
  private drawnOnce = false;
  private lastK = 0;
  private hoverId: string | null = null;
  private selectedId: string | null = null;
  private t0 = performance.now();

  /** A press on the canvas: where, and whether it turns the farm instead of moving it. */
  private press: { id: number; moved: boolean; turn: boolean; x: number; y: number } | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly labelHost: HTMLElement,
    private readonly events: FarmEngineEvents,
  ) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor('#a8d484', 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The sun and the farm hold still as the view moves: the shadows are drawn again only with the farm.
    this.renderer.shadowMap.autoUpdate = false;
    this.canvas = this.renderer.domElement;
    Object.assign(this.canvas.style, { cursor: 'grab', display: 'block', height: '100%', touchAction: 'none', width: '100%' });
    host.appendChild(this.canvas);

    this.scene.add(new THREE.HemisphereLight(LIGHT.sky, LIGHT.ground, LIGHT.skyIntensity));
    this.sun = new THREE.DirectionalLight(LIGHT.sun, LIGHT.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.8;
    this.sun.shadow.radius = 2.5;
    this.scene.add(this.sun, this.sun.target);

    // The bed under the pointer, and the plot picked.
    const accent = getComputedStyle(host).getPropertyValue('--accent').trim() || '#2563eb';
    const slab = new THREE.BoxGeometry(1, 1.2, 1);
    const hoverMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', depthWrite: false, opacity: 0.55, transparent: true });
    const activeMaterial = new THREE.MeshBasicMaterial({ color: accent, depthWrite: false, opacity: 0.4, transparent: true });
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 10, 1));
    const edgeMaterial = new THREE.LineBasicMaterial({ color: accent });
    this.owned.push(slab, hoverMaterial, activeMaterial, edges, edgeMaterial);
    this.hover = new THREE.Mesh(slab, hoverMaterial);
    this.hover.visible = false;
    this.hover.renderOrder = 3;
    this.active = new THREE.Group();
    this.active.add(new THREE.Mesh(slab, activeMaterial), new THREE.LineSegments(edges, edgeMaterial));
    this.active.visible = false;
    this.active.renderOrder = 3;
    this.scene.add(this.hover, this.active);

    this.size = { height: Math.max(1, host.clientHeight), width: Math.max(1, host.clientWidth) };
    this.renderer.setSize(this.size.width, this.size.height, false);

    this.observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.round(entry.contentRect.width));
      const height = Math.max(1, Math.round(entry.contentRect.height));
      if (width === this.size.width && height === this.size.height) return;
      this.size = { height, width };
      this.renderer.setSize(width, height, false);
      // What was under the pointer may not be now.
      if (this.hoverId) this.setHover(null);
      // Until it's been moved by hand the farm stays fitted to the box as it changes size.
      if (this.farm && !this.touched) {
        if (this.animation) this.animation.to = this.fitted(this.animation.to);
        else this.pose = this.fitted(this.pose);
      }
      this.invalidate();
    });
    this.observer.observe(host);
    this.onScreen = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.invalidate();
    });
    this.onScreen.observe(host);

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.stop);
    // Safari's (and the Mac app's) trackpad pinch comes as gestures, not a wheel with ctrl held.
    this.canvas.addEventListener('gesturestart', this.onGestureStart as EventListener);
    this.canvas.addEventListener('gesturechange', this.onGestureChange as EventListener);
    this.canvas.addEventListener('gestureend', this.stop);
  }

  // ---- What's drawn --------------------------------------------------------

  setFarm(farm: FarmBuilt) {
    // The first farm opens (top view tipping back, plants growing); one drawn again after the data changed stays as the view has it.
    const first = this.opening === null;
    if (this.farm) {
      this.scene.remove(this.farm.group);
      this.farm.dispose();
    }
    this.farm = farm;
    this.scene.add(farm.group);
    const { maxX, maxY, maxZ, minX, minZ } = farm.bounds;
    const reach = Math.hypot(maxX - minX, maxZ - minZ);
    this.distance = Math.max(2500, reach * 1.4 + maxY * 4);
    // The sun from the west, high: shadows fall to the right of the view.
    const middle = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    this.sun.target.position.copy(middle);
    this.sun.position.copy(middle).add(SUN_FROM.clone().multiplyScalar(reach + 400));
    const shadow = this.sun.shadow.camera;
    const half = reach / 2 + 80;
    shadow.left = -half;
    shadow.right = half;
    shadow.top = half;
    shadow.bottom = -half;
    shadow.near = 10;
    shadow.far = reach * 2 + 1200;
    shadow.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld();
    this.renderer.shadowMap.needsUpdate = true;

    this.setLabels(farm.labels);
    this.hoverId = null;
    this.hover.visible = false;
    this.placeActive();

    if (!first) {
      farm.grow.value = 1;
      this.invalidate();
      return;
    }
    // It opens as the web's does: looking straight down, then tipping back into the isometric view, the plants growing up.
    const top = this.fitted({ azimuth: 0, elevation: TOP_ELEVATION, k: 1, tx: 0, tz: 0 });
    const home = this.fitted({ azimuth: ISO_AZIMUTH, elevation: ISO_ELEVATION, k: 1, tx: 0, tz: 0 });
    this.opening = 0;
    if (this.reduced) {
      this.pose = home;
      farm.grow.value = 1;
    } else {
      this.pose = top;
      farm.grow.value = 0;
      this.animate(home, TILT_MS);
    }
    this.invalidate();
  }

  private setLabels(labels: FarmLabel[]) {
    for (const label of this.labels) label.element.remove();
    this.labels = labels.map((label) => {
      const element = document.createElement('div');
      element.className = 'farm-tag';
      element.style.setProperty('--edge', label.border);
      element.style.color = label.color;
      element.innerHTML = '<i></i>';
      element.append(document.createTextNode(label.text));
      element.querySelector('i')!.style.background = label.color;
      this.labelHost.appendChild(element);
      return { anchor: new THREE.Vector3(...label.anchor), element };
    });
  }

  /** The plot picked is lit under its name (none: nothing is). */
  setSelected(id: string | null) {
    this.selectedId = id;
    this.placeActive();
    this.invalidate();
  }

  private placeActive() {
    const top = this.selectedId ? this.farm?.bedTops.get(this.selectedId) : undefined;
    this.active.visible = Boolean(top);
    if (!top) return;
    const size = this.farm?.bedSizes.get(this.selectedId!) ?? { h: PLOT_H, w: PLOT_W };
    this.active.position.set(top.x, top.y + 0.6, top.z);
    this.active.scale.set(size.w + 4, 1, size.h + 4);
  }

  // ---- The bar's buttons ---------------------------------------------------

  run(command: 'zoomIn' | 'zoomOut' | 'fit' | 'turnLeft' | 'turnRight') {
    if (!this.farm) return;
    const { azimuth, elevation } = this.pose;
    if (command === 'fit') {
      this.touched = false;
      this.animate(this.fitted({ ...this.pose, azimuth, elevation }), 500);
    } else if (command === 'zoomIn' || command === 'zoomOut') {
      const middle = this.middle();
      this.zoomAt(middle.x, middle.y, this.pose.k * (command === 'zoomIn' ? 1.25 : 0.8));
    } else {
      this.animate(this.fitted({ ...this.pose, azimuth: azimuth + (command === 'turnLeft' ? ISO_AZIMUTH : -ISO_AZIMUTH) }), 600);
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.onScreen.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.stop);
    this.canvas.removeEventListener('gesturestart', this.onGestureStart as EventListener);
    this.canvas.removeEventListener('gesturechange', this.onGestureChange as EventListener);
    this.canvas.removeEventListener('gestureend', this.stop);
    for (const label of this.labels) label.element.remove();
    this.labels = [];
    if (this.farm) {
      this.scene.remove(this.farm.group);
      this.farm.dispose();
      this.farm = null;
    }
    for (const thing of this.owned) thing.dispose();
    this.sun.shadow.map?.dispose();
    // The browser keeps only so many WebGL contexts: let this one go now, not when it gets round to it.
    this.renderer.dispose();
    if (!this.renderer.getContext().isContextLost()) this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  // ---- The frame -----------------------------------------------------------

  /** Another frame is wanted: at once if it holds still, else it's already coming. */
  private invalidate() {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    this.frame = 0;
    if (this.disposed) return;
    if (!this.visible || document.hidden) {
      // Nothing's drawn while it's out of sight; it picks up again when it comes back.
      this.last = 0;
      if (!this.visible) return;
      this.invalidate();
      return;
    }
    let moving = !this.reduced;
    const dt = this.last ? Math.min(now - this.last, 64) : 0;
    this.last = now;
    const animation = this.animation;
    if (animation) {
      animation.elapsed += dt;
      const t = Math.min(1, animation.elapsed / Math.max(1, animation.duration));
      const k = ease(t);
      const at = (a: number, b: number) => a + (b - a) * k;
      this.pose = {
        azimuth: at(animation.from.azimuth, animation.to.azimuth),
        elevation: at(animation.from.elevation, animation.to.elevation),
        k: at(animation.from.k, animation.to.k),
        tx: at(animation.from.tx, animation.to.tx),
        tz: at(animation.from.tz, animation.to.tz),
      };
      if (t >= 1) {
        this.pose = animation.to;
        this.animation = null;
      }
      moving = true;
    }
    if (this.farm) {
      if (!this.reduced) {
        // The plants and grass grow up once the tilt has begun; the wind never stops.
        if (this.opening !== null && this.opening < GROW_WAIT_MS + GROW_MS) {
          this.opening += dt;
          this.farm.grow.value = Math.min(1, Math.max(0, (this.opening - GROW_WAIT_MS) / GROW_MS));
        }
        this.farm.animate((now - this.t0) / 1000);
      }
    }
    this.draw();
    if (moving) this.invalidate();
  };

  private place() {
    const { azimuth, elevation, k, tx, tz } = this.pose;
    const { height, width } = this.size;
    const camera = this.camera;
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    // The land, centred under the view and as big as it shows (tilted, it runs further back), so it never ends.
    const land = this.farm?.land;
    const reach = Math.max(width, height / Math.max(Math.sin(elevation), 0.25)) / k + 600;
    if (land) {
      land.position.set(tx, 0, tz);
      land.scale.set(reach * 1.5, 1, reach * 1.5);
    }
    camera.near = 1;
    camera.far = this.distance * 2 + 4000 + reach;
    camera.zoom = k;
    camera.rotation.set(-elevation, azimuth, 0, 'YXZ');
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
    camera.position.set(tx, 0, tz).addScaledVector(forward, -this.distance);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  private draw() {
    this.place();
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
    if (Math.abs(this.pose.k - this.lastK) > 0.0005) {
      this.lastK = this.pose.k;
      this.events.onZoom(this.pose.k);
    }
    if (!this.drawnOnce && this.farm) {
      this.drawnOnce = true;
      this.events.onFirstFrame();
    }
  }

  private placeLabels() {
    const point = new THREE.Vector3();
    const { height, width } = this.size;
    const readable = this.pose.k >= TAG_MIN_K;
    for (const label of this.labels) {
      point.copy(label.anchor).project(this.camera);
      const x = ((point.x + 1) / 2) * width;
      const y = ((1 - point.y) / 2) * height;
      const onScreen = x > -120 && x < width + 120 && y > -40 && y < height + 60;
      label.element.style.visibility = readable && onScreen ? 'visible' : 'hidden';
      label.element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-6px, -100%)`;
    }
  }

  private animate(to: Pose, duration: number) {
    if (this.reduced) {
      this.pose = to;
      this.animation = null;
    } else {
      this.animation = { duration, from: { ...this.pose }, elapsed: 0, to };
    }
    this.invalidate();
  }

  /** The whole farm in view, turned and tilted as `pose` is: as big as it'll go. */
  private fitted(pose: Pose): Pose {
    if (!this.farm) return pose;
    const { bounds, content } = this.farm;
    const { azimuth: a, elevation: e } = pose;
    const { bottom, left, right: rightmost, top } = extent(content, bounds.maxY, a, e);
    const k = THREE.MathUtils.clamp(Math.min((this.size.width - SIDE * 2) / Math.max(1, rightmost - left), (this.size.height - TOP_ROOM - BOTTOM_ROOM) / Math.max(1, top - bottom)), MIN_K, FIT_MAX_K);
    const across = (left + rightmost) / 2;
    const lower = (TOP_ROOM - BOTTOM_ROOM) / 2 / k;
    const along = -((bottom + top) / 2 + lower) / Math.max(0.2, Math.sin(e));
    return { ...pose, k, tx: across * Math.cos(a) + along * Math.sin(a), tz: -across * Math.sin(a) + along * Math.cos(a) };
  }

  // ---- Looking around ------------------------------------------------------

  private readonly stop = (event: Event) => event.preventDefault();

  private toDevice(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  /** The ground point under a screen point, as the camera is now. */
  private groundAt(clientX: number, clientY: number) {
    this.place();
    this.raycaster.setFromCamera(this.toDevice(clientX, clientY), this.camera);
    return this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
  }

  /** Moves the view so the ground under (fromX, fromY) is under (toX, toY). */
  private slide(fromX: number, fromY: number, toX: number, toY: number) {
    const from = this.groundAt(fromX, fromY);
    const to = this.groundAt(toX, toY);
    if (!from || !to) return;
    this.animation = null;
    this.touched = true;
    this.pose = { ...this.pose, tx: this.pose.tx + from.x - to.x, tz: this.pose.tz + from.z - to.z };
    this.invalidate();
  }

  private middle() {
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  /** Zooms about a screen point, keeping the ground under it. */
  private zoomAt(clientX: number, clientY: number, k: number) {
    this.animation = null;
    this.touched = true;
    const before = this.groundAt(clientX, clientY);
    this.pose = { ...this.pose, k: THREE.MathUtils.clamp(k, MIN_K, MAX_K) };
    const after = this.groundAt(clientX, clientY);
    if (before && after) this.pose = { ...this.pose, tx: this.pose.tx + before.x - after.x, tz: this.pose.tz + before.z - after.z };
    this.invalidate();
  }

  /** The bed at a screen point (its plot's id), or null. */
  private bedAt(clientX: number, clientY: number): string | null {
    const beds = this.farm?.beds;
    if (!beds || !this.farm) return null;
    this.place();
    this.raycaster.setFromCamera(this.toDevice(clientX, clientY), this.camera);
    const index = this.raycaster.intersectObject(beds, false)[0]?.instanceId;
    return index === undefined ? null : (this.farm.bedCells[index]?.id ?? null);
  }

  private setHover(id: string | null, clientX = 0, clientY = 0) {
    const rect = this.canvas.getBoundingClientRect();
    if (id !== this.hoverId) {
      this.hoverId = id;
      const top = id ? this.farm?.bedTops.get(id) : undefined;
      this.hover.visible = Boolean(top);
      if (top && id) {
        const size = this.farm?.bedSizes.get(id) ?? { h: PLOT_H, w: PLOT_W };
        this.hover.position.set(top.x, top.y + 0.6, top.z);
        this.hover.scale.set(size.w + 4, 1, size.h + 4);
      }
      this.canvas.style.cursor = id ? 'pointer' : 'grab';
      this.invalidate();
    }
    this.events.onHover(id, clientX - rect.left, clientY - rect.top);
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (this.press) return;
    this.canvas.setPointerCapture(event.pointerId);
    this.press = { id: event.pointerId, moved: false, turn: event.button === 2 || event.shiftKey, x: event.clientX, y: event.clientY };
    this.canvas.style.cursor = 'grabbing';
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const press = this.press;
    if (!press || press.id !== event.pointerId) {
      this.setHover(this.bedAt(event.clientX, event.clientY), event.clientX, event.clientY);
      return;
    }
    if (!press.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) < TAP_SLOP) return;
    press.moved = true;
    this.setHover(null);
    if (press.turn) {
      this.animation = null;
      this.touched = true;
      this.pose = { ...this.pose, azimuth: this.pose.azimuth - (event.clientX - press.x) * 0.006 };
    } else {
      this.slide(press.x, press.y, event.clientX, event.clientY);
    }
    press.x = event.clientX;
    press.y = event.clientY;
    this.invalidate();
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const press = this.press;
    if (!press || press.id !== event.pointerId) return;
    this.press = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.canvas.style.cursor = this.hoverId ? 'pointer' : 'grab';
    if (!press.moved && event.type === 'pointerup') this.events.onPick(this.bedAt(event.clientX, event.clientY));
  };

  private readonly onPointerLeave = () => {
    if (!this.press) this.setHover(null);
  };

  private gestureFrom = 1;

  private readonly onGestureStart = (event: Event) => {
    event.preventDefault();
    this.gestureFrom = this.pose.k;
  };

  private readonly onGestureChange = (event: Event) => {
    event.preventDefault();
    const { clientX, clientY, scale } = event as Event & { clientX: number; clientY: number; scale: number };
    if (Number.isFinite(scale) && scale > 0) this.zoomAt(clientX, clientY, this.gestureFrom * scale);
  };

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    // A pinch on the trackpad comes as a wheel with ctrl held: finer steps.
    const rate = event.ctrlKey ? 0.01 : 0.0015;
    this.zoomAt(event.clientX, event.clientY, this.pose.k * Math.exp(-event.deltaY * rate));
  };
}
