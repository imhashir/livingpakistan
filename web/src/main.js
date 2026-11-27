import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel/900.css';
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
  const app = new App({ stage, board, water, sky, lighting, data, voidPlane });
  await app.init();
  instrument(app); // wraps the app's public methods to report usage to GA4
  stage.onTick((t) => {
    water.uniforms.uTime.value = t;
    board.uniforms.uTime.value = t;
    voidPlane.uniforms.uTime.value = t;
  });
  stage.start();
  document.getElementById('loader').classList.add('gone');
  window.__pakciv = app;
  // let a couple of frames render before announcing readiness (used by the screenshot harness)
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__pakciv_ready = true; }));
}

boot().catch((e) => {
  console.error(e);
  say('Something went wrong: ' + e.message);
});
export { THREE };
