/**
 * use3DScene — 3D 粒子播放场景（移植自 Mineradio 粒子可视化引擎）
 *
 * 在 Three.js 中渲染一个粒子点云，粒子颜色采样自专辑封面，位置由音频
 * 频段（bass / mid / treble / beat / energy）驱动位移。仅 silk 预设。
 *
 * 音频数据来自 useAudioVisualizer 的程序化模拟（fillFrequency → 0..255
 * bins），通过 createBandExtractor 派生 bass/mid/treble/beat/energy。
 */
import * as THREE from "three";
import type { Scene3D } from "@/types";

const PLANE_SIZE = 4.8;
const GRID = 120;

const SIMPLEX_GLSL = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`;

const VERTEX_SHADER = `
precision highp float;
attribute vec2 aUv;
attribute float aRand;
uniform float uTime, uBass, uMid, uTreble, uBeat, uEnergy, uPreset, uIntensity;
uniform sampler2D uCoverTex;
uniform float uHasCover;
uniform float uPixel;
uniform vec2 uMouseXY;
uniform float uMouseActive;
uniform float uAlpha;
varying vec3 vColor;
varying float vBright, vAlpha;

${SIMPLEX_GLSL}

vec3 sampleCover(vec2 uv) {
  if (uHasCover > 0.5) return texture2D(uCoverTex, uv).rgb;
  return mix(
    vec3(0.36, 0.28, 0.72),
    mix(vec3(0.95, 0.55, 0.65), vec3(0.45, 0.78, 0.95), uv.x),
    uv.y
  );
}

void main() {
  vec3 pos = position;
  float t = uTime;
  float K = uIntensity * 1.6;
  float bassDisp = snoise(vec3(position.x*0.35, position.y*0.35, t*0.4)) * uBass * 0.42 * K;
  float midN = snoise(vec3(position.x*1.4, position.y*1.4, t*0.55)) * 0.6
             + snoise(vec3(position.x*2.8+5.0, position.y*2.8-3.0, t*0.85)) * 0.4;
  float midDisp = midN * uMid * 0.55 * K;
  float trebleJ = snoise(vec3(position.x*6.5, position.y*6.5, t*3.5 + aRand*4.0)) * uTreble * 0.18 * K;
  vec3 coverColor = sampleCover(aUv);
  vColor = coverColor;

  // SILK — 封面粒子平面 + Z 位移
  pos.z = midDisp + trebleJ + bassDisp;

  if (uMouseActive > 0.5) {
    vec2 d = pos.xy - uMouseXY;
    float dist = length(d);
    float push = exp(-dist * dist * 0.6) * 0.55;
    pos.xy += normalize(d + 0.0001) * push;
  }

  vBright = 0.82 + uBass * 0.12 + uEnergy * 0.08 + uBeat * 0.25;
  vAlpha = uAlpha;

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  float depthSize = 36.0 / max(0.5, -mvPos.z);
  float audioBoost = 1.0 + uBeat * 0.30 + uEnergy * 0.15 + uBass * 0.10;
  float sz = clamp(depthSize * audioBoost, 1.0, 6.5);
  gl_PointSize = sz * uPixel;
  gl_Position = projectionMatrix * mvPos;
}
`;

const FRAGMENT_SHADER = `
precision highp float;
uniform sampler2D uDotTex;
uniform float uAlpha;
varying vec3 vColor;
varying float vBright, vAlpha;

void main() {
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.02) discard;
  vec3 col = vColor * vBright;
  float lum = dot(vColor, vec3(0.299, 0.587, 0.114));
  float darkMix = 1.0 - smoothstep(0.08, 0.22, lum);
  vec3 defaultCol = mix(vec3(0.55, 0.45, 0.85), vec3(0.45, 0.7, 0.95), vColor.b);
  col = mix(col, defaultCol * vBright, darkMix * 0.85);
  col = clamp(col, vec3(0.0), vec3(1.6));
  gl_FragColor = vec4(col, tex.a * uAlpha * vAlpha);
}
`;

const BLOOM_VERTEX = VERTEX_SHADER.replace(
  "float sz = clamp(depthSize * audioBoost, 1.0, 6.5);\n  gl_PointSize = sz * uPixel;",
  "float sz = clamp(depthSize * audioBoost, 1.0, 6.5);\n  gl_PointSize = sz * uPixel * uBloomSize;"
);

const BLOOM_FRAGMENT = `
precision highp float;
uniform sampler2D uDotTex;
uniform float uAlpha, uBloomStrength;
varying vec3 vColor;
varying float vBright, vAlpha;

void main() {
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.01) discard;
  float soft = tex.a * tex.a;
  vec3 col = vColor * (0.55 + vBright * 0.62);
  float lum = dot(vColor, vec3(0.299, 0.587, 0.114));
  float darkMix = 1.0 - smoothstep(0.08, 0.22, lum);
  vec3 defaultCol = mix(vec3(0.55, 0.45, 0.85), vec3(0.45, 0.7, 0.95), vColor.b);
  col = mix(col, defaultCol * (0.55 + vBright * 0.62), darkMix * 0.7);
  col = clamp(col, vec3(0.0), vec3(1.8));
  gl_FragColor = vec4(col, soft * uAlpha * uBloomStrength * vAlpha * 0.55);
}
`;

function makeDotTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
  g.addColorStop(0.0, "rgba(255,255,255,0.96)");
  g.addColorStop(0.42, "rgba(255,255,255,0.78)");
  g.addColorStop(0.72, "rgba(255,255,255,0.22)");
  g.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function buildGridGeometry(): THREE.BufferGeometry {
  const count = GRID * GRID;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const rand = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const gx = i % GRID;
    const gy = Math.floor(i / GRID);
    const px = gx / (GRID - 1);
    const py = gy / (GRID - 1);
    positions[i * 3] = (px - 0.5) * PLANE_SIZE;
    positions[i * 3 + 1] = (py - 0.5) * PLANE_SIZE;
    positions[i * 3 + 2] = 0;
    uvs[i * 2] = (gx + 0.5) / GRID;
    uvs[i * 2 + 1] = (gy + 0.5) / GRID;
    rand[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aUv", new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute("aRand", new THREE.BufferAttribute(rand, 1));
  return geo;
}

const PRESET_INDEX: Record<Exclude<Scene3D, "off">, number> = { silk: 0 };

export interface Scene3DAnalysis {
  bass: number;
  mid: number;
  treble: number;
  beat: number;
  energy: number;
}

export class ThreeScene3D {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private particles: THREE.Points;
  private bloomParticles: THREE.Points;
  private material: THREE.ShaderMaterial;
  private bloomMaterial: THREE.ShaderMaterial;
  private uniforms: Record<string, THREE.IUniform>;
  private dotTex: THREE.CanvasTexture;
  private coverTex: THREE.Texture | null = null;
  private coverImage: HTMLImageElement | null = null;
  private container: HTMLElement;
  private rafId = 0;
  private prevTime = 0;
  private baseFov = 45;
  private preset: Exclude<Scene3D, "off"> = "silk";
  private alpha = 0;
  private targetAlpha = 1;
  private mouse = new THREE.Vector2(-999, -999);
  private mouseActive = false;
  private cineTheta = 0;
  private userTheta = 0;
  private userPhi = 0.08;
  private userRadius = 6.6;
  private disposed = false;
  private analysisCb: (() => Scene3DAnalysis) | null = null;
  private ro: ResizeObserver | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, w / h, 0.1, 100);
    this.camera.position.set(0, 0, 6.6);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(w, h);
    this.renderer.domElement.style.background = "transparent";
    this.renderer.domElement.style.position = "absolute";
    this.renderer.domElement.style.inset = "0";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    container.appendChild(this.renderer.domElement);
    this.dotTex = makeDotTexture();
    const geo = buildGridGeometry();
    this.uniforms = {
      uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
      uBeat: { value: 0 }, uEnergy: { value: 0 }, uPreset: { value: 0 }, uIntensity: { value: 0.95 },
      uCoverTex: { value: this.dotTex }, uHasCover: { value: 0 }, uPixel: { value: this.renderer.getPixelRatio() },
      uMouseXY: { value: new THREE.Vector2(-999, -999) }, uMouseActive: { value: 0 }, uAlpha: { value: 0 },
      uDotTex: { value: this.dotTex }, uBloomStrength: { value: 0.62 }, uBloomSize: { value: 2.65 },
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.NormalBlending });
    this.particles = new THREE.Points(geo, this.material);
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 1;
    this.scene.add(this.particles);
    this.bloomMaterial = new THREE.ShaderMaterial({ vertexShader: BLOOM_VERTEX, fragmentShader: BLOOM_FRAGMENT, uniforms: this.uniforms, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    this.bloomParticles = new THREE.Points(geo, this.bloomMaterial);
    this.bloomParticles.frustumCulled = false;
    this.bloomParticles.renderOrder = 0;
    this.scene.add(this.bloomParticles);
    this.container.addEventListener("pointermove", this.onPointerMove);
    this.container.addEventListener("pointerleave", this.onPointerLeave);
    this.prevTime = performance.now();
    this.loop();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
  }

  setAnalysisCallback(cb: () => Scene3DAnalysis) { this.analysisCb = cb; }

  setPreset(p: Exclude<Scene3D, "off">) {
    this.preset = p;
    this.uniforms.uPreset.value = PRESET_INDEX[p];
    if (p === "silk") { this.userRadius = 6.6; this.userPhi = 0.08; this.userTheta = 0; }
  }

  setCover(url: string | null) {
    if (!url) { this.uniforms.uHasCover.value = 0; return; }
    if (this.coverImage) { this.coverImage.src = url; return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
      if (this.coverTex) this.coverTex.dispose();
      this.coverTex = tex;
      this.uniforms.uCoverTex.value = tex;
      this.uniforms.uHasCover.value = 1;
    };
    img.onerror = () => { this.uniforms.uHasCover.value = 0; };
    img.src = url;
    this.coverImage = img;
  }

  setAlphaTarget(a: number) { this.targetAlpha = a; }

  private onPointerMove = (e: PointerEvent) => {
    const rect = this.container.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    this.mouse.set(nx * 2.4, ny * 2.4);
    this.mouseActive = true;
  };
  private onPointerLeave = () => { this.mouseActive = false; };

  resize() {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.uniforms.uPixel.value = this.renderer.getPixelRatio();
  }

  private loop = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min((now - this.prevTime) / 1000, 0.05);
    this.prevTime = now;
    this.uniforms.uTime.value += dt;
    if (this.analysisCb) {
      const a = this.analysisCb();
      this.uniforms.uBass.value = a.bass; this.uniforms.uMid.value = a.mid;
      this.uniforms.uTreble.value = a.treble; this.uniforms.uBeat.value = a.beat;
      this.uniforms.uEnergy.value = a.energy;
    }
    this.alpha += (this.targetAlpha - this.alpha) * 0.08;
    this.uniforms.uAlpha.value = this.alpha;
    this.uniforms.uMouseXY.value.copy(this.mouse);
    this.uniforms.uMouseActive.value = this.mouseActive ? 1 : 0;
    this.cineTheta += dt * 0.06;
    const theta = this.userTheta + Math.sin(this.cineTheta * 0.5) * 0.12;
    const phi = this.userPhi + Math.sin(this.cineTheta * 0.3) * 0.04;
    const radius = this.userRadius;
    const cy = Math.cos(phi), sy = Math.sin(phi), ct = Math.cos(theta), st = Math.sin(theta);
    this.camera.position.set(radius * cy * st, radius * sy, radius * cy * ct);
    this.camera.lookAt(0, 0, 0);
    const punch = (this.uniforms.uBeat.value as number) * 2.2;
    this.camera.fov = this.baseFov - punch;
    this.camera.updateProjectionMatrix();
    const rotY = this.mouseActive ? this.mouse.x * 0.05 : 0;
    this.particles.rotation.y += (rotY - this.particles.rotation.y) * 0.04;
    this.bloomParticles.rotation.copy(this.particles.rotation);
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.container.removeEventListener("pointermove", this.onPointerMove);
    this.container.removeEventListener("pointerleave", this.onPointerLeave);
    this.ro?.disconnect();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.material.dispose();
    this.bloomMaterial.dispose();
    this.particles.geometry.dispose();
    this.dotTex.dispose();
    if (this.coverTex) this.coverTex.dispose();
    this.renderer.dispose();
  }
}

export function createBandExtractor() {
  const buffer = new Uint8Array(32);
  let bassHistory: number[] = [];
  let lastBeatTime = 0;
  let beatPulse = 0;
  let smoothBass = 0, smoothMid = 0, smoothTreb = 0, smoothEnergy = 0;
  let lastTickMs = 0;
  function env(cur: number, target: number, attack: number, release: number) {
    return target > cur ? cur + (target - cur) * attack : cur + (target - cur) * release;
  }
  return {
    buffer,
    extract(fillFrequency: (out: Uint8Array) => boolean): Scene3DAnalysis & { active: boolean } {
      const now = performance.now();
      const dt = lastTickMs ? Math.min((now - lastTickMs) / 1000, 0.05) : 0.016;
      lastTickMs = now;
      const active = fillFrequency(buffer);
      const n = buffer.length;
      const bassEnd = Math.max(1, Math.floor(n * 0.2));
      const midEnd = Math.max(bassEnd + 1, Math.floor(n * 0.55));
      let bSum = 0, mSum = 0, tSum = 0, eSum = 0;
      for (let i = 0; i < n; i++) {
        const v = buffer[i] / 255; eSum += v;
        if (i < bassEnd) bSum += v; else if (i < midEnd) mSum += v; else tSum += v;
      }
      const bass = bSum / bassEnd;
      const mid = mSum / (midEnd - bassEnd);
      const treble = tSum / (n - midEnd);
      const energy = eSum / n;
      smoothBass = env(smoothBass, bass, 0.3, 0.08);
      smoothMid = env(smoothMid, mid, 0.2, 0.07);
      smoothTreb = env(smoothTreb, treble, 0.2, 0.06);
      smoothEnergy = env(smoothEnergy, energy, 0.18, 0.06);
      bassHistory.push(bass);
      if (bassHistory.length > 30) bassHistory.shift();
      const avg = bassHistory.reduce((a, b) => a + b, 0) / bassHistory.length;
      if (bass > 0.35 && bass > avg * 1.35 && now - lastBeatTime > 0.28 && smoothEnergy > 0.15) {
        beatPulse = Math.min(1, beatPulse + 0.7); lastBeatTime = now;
      }
      beatPulse *= Math.pow(0.0008, dt);
      if (beatPulse < 0.001) beatPulse = 0;
      return { bass: smoothBass, mid: smoothMid, treble: smoothTreb, beat: beatPulse, energy: Math.max(smoothEnergy, beatPulse * 0.3), active };
    },
    reset() { bassHistory = []; lastBeatTime = 0; beatPulse = 0; smoothBass = 0; smoothMid = 0; smoothTreb = 0; smoothEnergy = 0; lastTickMs = 0; },
  };
}
