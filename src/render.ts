// Three.js top-down renderer. The sim is 2D { x, z }; here x → x, z → z,
// camera looks straight down. Orthographic so scroll-zoom is exact.
import * as THREE from 'three';
import { mulberry32, type GameState } from './world';

export type PickResult = { kind: 'asteroid' | 'ship'; id: number } | null;

const ROCK = 0x8a7f72;
const ROCK_HIT = 0xb0432f;
const ICE = 0x7fd4e8;
const ICE_HIT = 0x3fa8d8;

function glowTexture(inner: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.4, outer);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rockGeometry(seed: number): THREE.BufferGeometry {
  const rnd = mulberry32(seed);
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const s = 1 + (rnd() - 0.5) * 0.55;
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s, pos.getZ(i) * s);
  }
  geo.computeVertexNormals();
  return geo;
}

function circleLine(radius: number, color: number, opacity: number): THREE.LineLoop {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  return new THREE.LineLoop(geo, mat);
}

interface ShipVisual {
  group: THREE.Group;
  shieldRing: THREE.Mesh;
  selectRing: THREE.Mesh;
  flame: THREE.Mesh;
  beam: THREE.Line;
  beamTip: THREE.Sprite;
}

export class Renderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private halfH = 520;
  private rockMeshes = new Map<number, THREE.Mesh>();
  private pickupMeshes = new Map<number, THREE.Mesh>();
  private shipVisuals = new Map<number, ShipVisual>();
  private planetMeshes: THREE.Mesh[] = [];
  private moonMeshes: THREE.Mesh[] = [];
  private moveMarker: THREE.Mesh;
  private rockMat = new THREE.MeshBasicMaterial({ color: ROCK });
  private rockHitMat = new THREE.MeshBasicMaterial({ color: ROCK_HIT });
  private iceMat = new THREE.MeshBasicMaterial({ color: ICE });
  private iceHitMat = new THREE.MeshBasicMaterial({ color: ICE_HIT });
  private oreMat = new THREE.MeshBasicMaterial({ color: 0xffa63d });
  private icePickupMat = new THREE.MeshBasicMaterial({ color: 0x6ff2ff });
  private pickupGeo = new THREE.OctahedronGeometry(1);
  private raycaster = new THREE.Raycaster();
  private camTarget = { x: 470, z: 40 };
  private shake = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
    this.camera.position.set(0, 1000, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.onResize();
    window.addEventListener('resize', this.onResize);

    // Starfield backdrop.
    const starGeo = new THREE.BufferGeometry();
    const N = 900;
    const arr = new Float32Array(N * 3);
    const rnd = mulberry32(1337);
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 200 + rnd() * 2600;
      arr[i * 3] = Math.cos(a) * r;
      arr[i * 3 + 1] = -40;
      arr[i * 3 + 2] = Math.sin(a) * r;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.scene.add(
      new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xaFC4e8, size: 2, sizeAttenuation: false })),
    );

    // Move-order marker.
    this.moveMarker = new THREE.Mesh(
      new THREE.RingGeometry(8, 12, 32),
      new THREE.MeshBasicMaterial({ color: 0x59ffa0, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    this.moveMarker.rotation.x = -Math.PI / 2;
    this.moveMarker.visible = false;
    this.scene.add(this.moveMarker);

    this.renderer.domElement.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const f = e.deltaY > 0 ? 1.12 : 1 / 1.12;
        this.halfH = Math.min(1500, Math.max(120, this.halfH * f));
        this.onResize();
      },
      { passive: false },
    );
  }

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    const aspect = w / Math.max(1, h);
    this.camera.left = -this.halfH * aspect;
    this.camera.right = this.halfH * aspect;
    this.camera.top = this.halfH;
    this.camera.bottom = -this.halfH;
    this.camera.updateProjectionMatrix();
  };

  /** NDC-space pick against asteroids + ships. */
  pick(nx: number, ny: number): PickResult {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const rocks = [...this.rockMeshes.entries()].map(([id, m]) => ({ id, m }));
    const rockHits = this.raycaster.intersectObjects(rocks.map((r) => r.m), false);
    if (rockHits.length > 0) {
      const mesh = rockHits[0]!.object;
      const found = rocks.find((r) => r.m === mesh);
      if (found) return { kind: 'asteroid', id: found.id };
    }
    const ships = [...this.shipVisuals.entries()].map(([id, v]) => ({ id, g: v.group }));
    const shipHits = this.raycaster.intersectObjects(ships.map((s) => s.g), true);
    if (shipHits.length > 0) {
      let o: THREE.Object3D | null = shipHits[0]!.object;
      while (o) {
        const found = ships.find((s) => s.g === o);
        if (found) return { kind: 'ship', id: found.id };
        o = o.parent;
      }
    }
    return null;
  }

  screenToWorld(clientX: number, clientY: number): { x: number; z: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const halfW = (this.camera.right - this.camera.left) / 2;
    return {
      x: this.camTarget.x + nx * halfW,
      z: this.camTarget.z - ny * this.halfH,
    };
  }

  private buildShipVisual(drone: boolean): ShipVisual {
    const group = new THREE.Group();
    const color = drone ? 0x59c2ff : 0xffd659;
    const shape = new THREE.Shape();
    shape.moveTo(16, 0);
    shape.lineTo(-10, 11);
    shape.lineTo(-5, 0);
    shape.lineTo(-10, -11);
    shape.closePath();
    const hullGeo = new THREE.ShapeGeometry(shape);
    hullGeo.rotateX(-Math.PI / 2);
    const hull = new THREE.Mesh(hullGeo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    group.add(hull);
    const flameGeo = new THREE.Shape();
    flameGeo.moveTo(-10, 5);
    flameGeo.lineTo(-20, 0);
    flameGeo.lineTo(-10, -5);
    flameGeo.closePath();
    const flameShape = new THREE.ShapeGeometry(flameGeo);
    flameShape.rotateX(-Math.PI / 2);
    const flame = new THREE.Mesh(
      flameShape,
      new THREE.MeshBasicMaterial({ color: 0xff7a2f, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    group.add(flame);
    const shieldRing = new THREE.Mesh(
      new THREE.RingGeometry(20, 23, 40),
      new THREE.MeshBasicMaterial({ color: 0x4db8ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    shieldRing.rotation.x = -Math.PI / 2;
    group.add(shieldRing);
    const selectRing = new THREE.Mesh(
      new THREE.RingGeometry(26, 29, 40),
      new THREE.MeshBasicMaterial({ color: 0x59ffa0, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    selectRing.rotation.x = -Math.PI / 2;
    selectRing.visible = false;
    group.add(selectRing);
    const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const beam = new THREE.Line(
      beamGeo,
      new THREE.LineBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.95 }),
    );
    beam.visible = false;
    beam.frustumCulled = false;
    this.scene.add(beam);
    const beamTip = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture('rgba(255,220,150,1)', 'rgba(255,80,40,0.6)'),
        transparent: true,
        depthWrite: false,
      }),
    );
    beamTip.scale.set(40, 40, 1);
    beamTip.visible = false;
    this.scene.add(beamTip);
    this.scene.add(group);
    return { group, shieldRing, selectRing, flame, beam, beamTip };
  }

  sync(state: GameState, dt: number, markPos: { x: number; z: number } | null): void {
    // Star (rebuild glow only when radius changes — cheap enough to refresh scale).
    // Planets.
    while (this.planetMeshes.length < state.planets.length) {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(1, 48),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      m.rotation.x = -Math.PI / 2;
      this.scene.add(m);
      this.planetMeshes.push(m);
      const ring = circleLine(1, 0x3a4a6b, 0.5);
      this.scene.add(ring);
      (m as THREE.Mesh & { userData: { ring?: THREE.Object3D } }).userData.ring = ring;
    }
    // Moons (small pool, synced by flattened index).
    const flatMoons: { x: number; z: number; r: number; color: number }[] = [];
    state.planets.forEach((p) => {
      const px = Math.cos(p.angle) * p.orbitRadius;
      const pz = Math.sin(p.angle) * p.orbitRadius;
      for (const m of p.moons) {
        flatMoons.push({
          x: px + Math.cos(m.angle) * m.orbitRadius,
          z: pz + Math.sin(m.angle) * m.orbitRadius,
          r: m.radius,
          color: m.color,
        });
      }
    });
    while (this.moonMeshes.length < flatMoons.length) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0x9aa3b2 }));
      m.rotation.x = -Math.PI / 2;
      this.scene.add(m);
      this.moonMeshes.push(m);
    }
    this.moonMeshes.forEach((mesh, i) => {
      const f = flatMoons[i];
      mesh.visible = !!f;
      if (f) {
        mesh.position.set(f.x, 0, f.z);
        mesh.scale.set(f.r, f.r, 1);
        (mesh.material as THREE.MeshBasicMaterial).color.setHex(f.color);
      }
    });
    state.planets.forEach((p, i) => {
      const px = Math.cos(p.angle) * p.orbitRadius;
      const pz = Math.sin(p.angle) * p.orbitRadius;
      const m = this.planetMeshes[i]!;
      m.position.set(px, 0, pz);
      m.scale.set(p.radius, p.radius, 1);
      (m.material as THREE.MeshBasicMaterial).color.setHex(p.color);
      const ring = (m as unknown as { userData: { ring?: THREE.LineLoop } }).userData.ring;
      if (ring) {
        ring.position.set(0, -2, 0);
        ring.scale.set(p.orbitRadius, 1, p.orbitRadius);
      }
    });

    // Star mesh (idempotent): keep a single named mesh.
    let star = this.scene.getObjectByName('star') as THREE.Mesh | undefined;
    if (!star) {
      star = new THREE.Mesh(
        new THREE.CircleGeometry(1, 64),
        new THREE.MeshBasicMaterial({ color: 0xffd27a }),
      );
      star.rotation.x = -Math.PI / 2;
      star.name = 'star';
      this.scene.add(star);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture('rgba(255,210,130,1)', 'rgba(255,120,40,0.35)'),
          transparent: true,
          depthWrite: false,
        }),
      );
      glow.name = 'starglow';
      this.scene.add(glow);
    }
    star.scale.set(state.starRadius, state.starRadius, 1);
    const glow = this.scene.getObjectByName('starglow') as THREE.Sprite;
    glow.scale.set(state.starRadius * 4.2, state.starRadius * 4.2, 1);

    // Asteroids.
    const seen = new Set<number>();
    for (const a of state.asteroids) {
      seen.add(a.id);
      let mesh = this.rockMeshes.get(a.id);
      if (!mesh) {
        mesh = new THREE.Mesh(rockGeometry(a.seed), this.rockMat);
        mesh.scale.set(a.radius, a.radius * 0.7, a.radius);
        mesh.userData.seed = a.seed;
        this.scene.add(mesh);
        this.rockMeshes.set(a.id, mesh);
      }
      mesh.position.set(a.pos.x, 0, a.pos.z);
      mesh.rotation.y += a.spin * dt;
      const hurt = a.hp < a.maxHp * 0.5;
      mesh.material = a.icy ? (hurt ? this.iceHitMat : this.iceMat) : hurt ? this.rockHitMat : this.rockMat;
    }
    for (const [id, mesh] of this.rockMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.rockMeshes.delete(id);
      }
    }

    // Pickups.
    const seenP = new Set<number>();
    for (const p of state.pickups) {
      seenP.add(p.id);
      let mesh = this.pickupMeshes.get(p.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.pickupGeo, p.kind === 'ore' ? this.oreMat : this.icePickupMat);
        this.scene.add(mesh);
        this.pickupMeshes.set(p.id, mesh);
      }
      const s = 4 + Math.sin(state.time * 6 + p.id) * 1.2;
      mesh.scale.set(s, s, s);
      mesh.position.set(p.pos.x, 2, p.pos.z);
      mesh.rotation.y += 3 * dt;
    }
    for (const [id, mesh] of this.pickupMeshes) {
      if (!seenP.has(id)) {
        this.scene.remove(mesh);
        this.pickupMeshes.delete(id);
      }
    }

    // Ships.
    const seenS = new Set<number>();
    for (const s of state.ships) {
      if (!s.alive) continue;
      seenS.add(s.id);
      let v = this.shipVisuals.get(s.id);
      if (!v) {
        v = this.buildShipVisual(s.drone);
        this.shipVisuals.set(s.id, v);
      }
      v.group.position.set(s.pos.x, 4, s.pos.z);
      v.group.rotation.y = -s.angle;
      const speed = Math.hypot(s.vel.x, s.vel.z);
      v.flame.scale.set(0.4 + Math.min(1, speed / 90), 1, 1);
      v.flame.visible = speed > 8;
      const shieldFrac = s.shield / Math.max(1, 30 + 30 * s.slots.shield);
      (v.shieldRing.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.45 * Math.min(1, shieldFrac);
      v.shieldRing.visible = s.shield > 0.5;
      v.selectRing.visible = s.id === state.selectedId;
      // Mining beam.
      const rock = s.miningTargetId != null ? state.asteroids.find((a) => a.id === s.miningTargetId) : undefined;
      if (s.beamOn && rock) {
        const pts = [new THREE.Vector3(s.pos.x, 4, s.pos.z), new THREE.Vector3(rock.pos.x, 0, rock.pos.z)];
        v.beam.geometry.setFromPoints(pts);
        v.beam.visible = true;
        v.beamTip.position.set(rock.pos.x, 2, rock.pos.z);
        const flick = 30 + Math.random() * 22;
        v.beamTip.scale.set(flick, flick, 1);
        v.beamTip.visible = true;
        if (s.id === state.selectedId) this.shake = Math.min(6, this.shake + 30 * dt);
      } else {
        v.beam.visible = false;
        v.beamTip.visible = false;
      }
    }
    for (const [id, v] of this.shipVisuals) {
      if (!seenS.has(id)) {
        this.scene.remove(v.group);
        this.scene.remove(v.beam);
        this.scene.remove(v.beamTip);
        this.shipVisuals.delete(id);
      }
    }

    // Move marker.
    if (markPos) {
      this.moveMarker.visible = true;
      this.moveMarker.position.set(markPos.x, 1, markPos.z);
      const pulse = 1 + Math.sin(state.time * 8) * 0.12;
      this.moveMarker.scale.set(pulse, pulse, 1);
    } else {
      this.moveMarker.visible = false;
    }

    // Camera follows the selected ship.
    const sel = state.ships.find((s) => s.id === state.selectedId);
    if (sel) {
      this.camTarget.x += (sel.pos.x - this.camTarget.x) * Math.min(1, 5 * dt);
      this.camTarget.z += (sel.pos.z - this.camTarget.z) * Math.min(1, 5 * dt);
    }
    this.shake = Math.max(0, this.shake - 30 * dt);
    const shx = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const shz = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    this.camera.position.set(this.camTarget.x + shx, 1000, this.camTarget.z + shz);
    this.camera.lookAt(this.camTarget.x + shx, 0, this.camTarget.z + shz);
    this.renderer.render(this.scene, this.camera);
  }
}
