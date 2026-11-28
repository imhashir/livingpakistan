import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './style.css';
import * as THREE from 'three';
import { Stage } from './scene/stage.js';
import { Board } from './scene/board.js';
import { createWater, createSky, createVoid, Lighting } from './scene/environment.js';
import { loadAll } from './data.js';
import { App } from './app.js';
import { instrument } from './analytics.js';
import { QualityController } from './quality.js';

const sub = document.getElementById('loader-sub');
const say = (s) => { if (sub) sub.textContent = s; };

async function boot() {
  say('Unrolling the map…');
  const data = await loadAll(say);
  const stage = new Stage(document.getElementById('app'));
  say('Raising the Karakoram…');
  const board = new Board(data.world, stage.scene);
  const water = createWater(stage.scene, Math.max(board.W, board.H), board);
  const voidPlane = createVoid(stage.scene);
  const sky = createSky(stage.scene);
  const lighting = new Lighting(stage.scene, stage.renderer);
  // quality tier: each piece of the scene adjusts itself when the tier changes
  stage.onQuality((q) => { lighting.setQuality(q); board.setQuality(q); water.setQuality(q); voidPlane.setQuality(q); });
  const quality = new QualityController(stage);
  quality.setMode(quality.mode, { persist: false });
  const app = new App({ stage, board, water, sky, lighting, data, voidPlane, quality });
  await app.init();
  // compile every visible material before the first frame, without blocking the main thread
  // where the browser can compile in parallel (KHR_parallel_shader_compile)
  say('Lighting the lamps…');
  if (stage.renderer.extensions.has('KHR_parallel_shader_compile')) await stage.renderer.compileAsync(stage.scene, stage.camera).catch(() => {});
  instrument(app); // wraps the app's public methods to report usage to GA4
  // t is the ambient clock: real time on the high tier, slower or frozen on lower tiers
  stage.onTick((t) => {
    water.uniforms.uTime.value = t;
    board.uniforms.uTime.value = t;
    voidPlane.uniforms.uTime.value = t;
  });
  stage.start();
  document.getElementById('loader').classList.add('gone');
  window.__livingpakistan = app;
  // let a couple of frames render before announcing readiness (used by the screenshot harness)
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__livingpakistan_ready = true; }));
}

boot().catch((e) => {
  console.error(e);
  say('Something went wrong: ' + e.message);
});
export { THREE };
