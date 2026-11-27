// Sea surface, sky dome and the Day / Golden Hour / Nightlights lighting moods.
import * as THREE from 'three';

export function createWater(scene, size, board) {
  const geo = new THREE.PlaneGeometry(size * 3, size * 3, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(0x0d3557) },
    uShallow: { value: new THREE.Color(0x2c9fb0) },
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
    uSunColor: { value: new THREE.Color(0xffffff) },
    uNight: { value: 0 },
    uFogColor: { value: new THREE.Color(0xa9c9e4) },
    uFogNear: { value: 1500 }, uFogFar: { value: 5000 },
    uMask: { value: null }, uGrid: { value: new THREE.Vector3(board.grid.cols, board.grid.rows, board.grid.radius) },
    uOrigin: { value: new THREE.Vector2(board.ox, board.oz) },
  };
  const mask = new THREE.DataTexture(board.waterMask(), board.grid.cols, board.grid.rows, THREE.RGBAFormat);
  mask.magFilter = THREE.LinearFilter; mask.minFilter = THREE.LinearFilter; mask.needsUpdate = true;
  uniforms.uMask.value = mask;
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: `varying vec3 vWP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWP = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSunDir; uniform vec3 uSunColor;
      uniform float uNight; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; varying vec3 vWP;
      uniform sampler2D uMask; uniform vec3 uGrid; uniform vec2 uOrigin;
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec2 p = vWP.xz;
        vec2 m = p - uOrigin;
        float row = m.y / (1.5 * uGrid.z);
        float hc = m.x / (1.7320508 * uGrid.z) - 0.5 * mod(floor(row + 0.5), 2.0);
        float mk = texture2D(uMask, vec2((hc + 0.5) / uGrid.x, (row + 0.5) / uGrid.y)).r;
        bool outside = hc < -0.5 || hc > uGrid.x - 0.5 || row < -0.5 || row > uGrid.y - 0.5;
        if (outside && !(row > uGrid.y * 0.55 && hc < uGrid.x * 0.7)) discard; // open sea only to the south-west
        if (mk < 0.5) discard;
        float t = uTime;
        float w1 = n2(p * 0.08 + vec2(t * 0.15, t * 0.05));
        float w2 = n2(p * 0.23 - vec2(t * 0.2, -t * 0.12));
        float w3 = n2(p * 0.9 + vec2(t * 0.6, t * 0.3));
        vec3 nrm = normalize(vec3((w1 - 0.5) * 0.6 + (w3 - 0.5) * 0.25, 1.0, (w2 - 0.5) * 0.6 + (w3 - 0.5) * 0.2));
        vec3 V = normalize(cameraPosition - vWP);
        float fres = pow(1.0 - max(dot(nrm, V), 0.0), 3.0);
        vec3 R = reflect(-uSunDir, nrm);
        float spec = pow(max(dot(R, V), 0.0), 120.0) * 1.6 + pow(max(dot(R, V), 0.0), 18.0) * 0.12;
        vec3 col = mix(uDeep, uShallow, 0.25 + 0.25 * w1);
        col += fres * mix(vec3(0.55, 0.7, 0.85), vec3(0.08, 0.1, 0.2), uNight) * 0.45;
        col += uSunColor * spec * (1.0 - uNight * 0.7);
        float glint = step(0.992, h(floor(p * 1.6) + floor(t * 3.0))) * (1.0 - uNight) * 0.5;
        col += glint * uSunColor;
        float d = length(cameraPosition - vWP);
        float fog = smoothstep(uFogNear, uFogFar, d);
        col = mix(col, uFogColor, fog);
        gl_FragColor = vec4(col, mix(0.72, 0.9, fres));
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.0;
  mesh.renderOrder = 2;
  scene.add(mesh);
  return { mesh, uniforms };
}

/** The fog-of-war void under and beyond the board: drifting parchment clouds. */
export function createVoid(scene) {
  const uniforms = { uTime: { value: 0 }, uA: { value: new THREE.Color(0x2a2c2f) }, uB: { value: new THREE.Color(0x5a5852) } };
  const mat = new THREE.ShaderMaterial({
    uniforms, depthWrite: true,
    vertexShader: `varying vec3 vWP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uA; uniform vec3 uB; varying vec3 vWP;
      float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=0.5, s=0.; for(int i=0;i<5;i++){ s+=a*n2(p); p*=2.03; a*=0.5; } return s; }
      void main(){ vec2 p = vWP.xz * 0.004 + vec2(uTime * 0.004, uTime * 0.002);
        float f = fbm(p + fbm(p * 1.7));
        vec3 c = mix(uA, uB, smoothstep(0.35, 0.8, f));
        float d = length(vWP.xz) / 2600.0;
        c *= 1.0 - smoothstep(0.6, 1.4, d) * 0.6;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const g = new THREE.PlaneGeometry(14000, 14000); g.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, mat); mesh.position.y = -9;
  scene.add(mesh);
  return { mesh, uniforms };
}

export function createSky(scene) {
  const uniforms = {
    uTop: { value: new THREE.Color(0x5d9bd6) }, uHorizon: { value: new THREE.Color(0xd8e8f2) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(0xffffff) }, uStars: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uStars; varying vec3 vDir;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9, 78.2, 37.7))) * 43758.5); }
      void main(){ float y = max(vDir.y, 0.0);
        vec3 c = mix(uHorizon, uTop, pow(y, 0.55));
        float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
        c += uSunColor * (pow(s, 400.0) * 3.0 + pow(s, 12.0) * 0.25);
        vec3 q = floor(vDir * 420.0);
        c += uStars * step(0.9975, h(q)) * smoothstep(0.05, 0.4, y);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), mat);
  scene.add(mesh);
  return { mesh, uniforms };
}

export const MOODS = {
  day: {
    label: 'Day', sunDir: [-0.35, 0.85, 0.4], sunColor: 0xfff4e0, sunI: 2.6, hemiSky: 0xcfe6ff, hemiGround: 0x6d5a3e,
    hemiI: 1.05, skyTop: 0x4f8fd0, skyHorizon: 0xd6e6ef, fog: 0xbcd3e3, fogNear: 2700, fogFar: 7500,
    deep: 0x0e3a5e, shallow: 0x2aa3b3, voidA: 0x3b3d3c, voidB: 0x77746a, night: 0, stars: 0, exposure: 1.0, bloom: 0.25,
  },
  golden: {
    label: 'Golden hour', sunDir: [-0.85, 0.3, 0.35], sunColor: 0xffc58f, sunI: 3.0, hemiSky: 0xd9d2ff, hemiGround: 0x4a3426,
    hemiI: 0.95, skyTop: 0x3f5f9a, skyHorizon: 0xffb27a, fog: 0xf0b98e, fogNear: 2400, fogFar: 6500,
    deep: 0x173a5c, shallow: 0x3d8ea0, voidA: 0x3a2a24, voidB: 0x7d5a44, night: 0.12, stars: 0, exposure: 1.05, bloom: 0.45,
  },
  night: {
    label: 'Nightlights', sunDir: [0.4, 0.6, -0.3], sunColor: 0x8fa8ff, sunI: 0.35, hemiSky: 0x223355, hemiGround: 0x05070c,
    hemiI: 0.35, skyTop: 0x02040b, skyHorizon: 0x0c1430, fog: 0x070b18, fogNear: 2600, fogFar: 7500,
    deep: 0x030a16, shallow: 0x0a2333, voidA: 0x020308, voidB: 0x0d1224, night: 1, stars: 1, exposure: 1.0, bloom: 1.1,
  },
};

export class Lighting {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    sc.left = -1100; sc.right = 1100; sc.top = 1100; sc.bottom = -1100; sc.near = 10; sc.far = 6000;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
    scene.add(sun); scene.add(sun.target);
    this.sun = sun;
    scene.fog = new THREE.Fog(0xbcd3e3, 1500, 5200);
  }
  apply(name, { water, sky, board, bloom, voidPlane }) {
    const m = MOODS[name]; this.mood = name;
    const d = new THREE.Vector3(...m.sunDir).normalize();
    this.sun.position.copy(d).multiplyScalar(2500);
    this.sun.color.setHex(m.sunColor); this.sun.intensity = m.sunI;
    this.hemi.color.setHex(m.hemiSky); this.hemi.groundColor.setHex(m.hemiGround); this.hemi.intensity = m.hemiI;
    this.scene.fog.color.setHex(m.fog); this.scene.fog.near = m.fogNear; this.scene.fog.far = m.fogFar;
    sky.uniforms.uTop.value.setHex(m.skyTop); sky.uniforms.uHorizon.value.setHex(m.skyHorizon);
    sky.uniforms.uSunDir.value.copy(d); sky.uniforms.uSunColor.value.setHex(m.sunColor); sky.uniforms.uStars.value = m.stars;
    water.uniforms.uDeep.value.setHex(m.deep); water.uniforms.uShallow.value.setHex(m.shallow);
    water.uniforms.uSunDir.value.copy(d); water.uniforms.uSunColor.value.setHex(m.sunColor);
    water.uniforms.uNight.value = m.night; water.uniforms.uFogColor.value.setHex(m.fog);
    water.uniforms.uFogNear.value = m.fogNear; water.uniforms.uFogFar.value = m.fogFar;
    board.uniforms.uNight.value = m.night;
    if (voidPlane) { voidPlane.uniforms.uA.value.setHex(m.voidA); voidPlane.uniforms.uB.value.setHex(m.voidB); }
    this.renderer.toneMappingExposure = m.exposure;
    if (bloom) bloom.strength = m.bloom;
    return m;
  }
}
