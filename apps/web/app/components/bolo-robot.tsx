"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/*
 * Bolo, as the three.js "RobotExpressive" character
 * (threejs.org/examples/#webgl_animation_skinning_morph). A fully-rigged robot
 * with built-in animations (Idle, Wave, Dance, Yes, No, ThumbsUp) and face
 * morphs (Surprised, Angry, Sad) that we map onto the voice phases:
 *
 *   idle → Idle · connecting → Wave · speaking → periodic Yes/Wave gestures
 *   listening → Surprised · working → Dance · ended → ThumbsUp · error → No+Angry
 *
 * Drag on it to spin it (with inertia); a quick tap triggers onTap. A
 * phase-coloured light washes over it and pulses with the live voice/mic level,
 * reading the app's own CSS theme tokens so it matches light and dark.
 */

export type RobotState =
  | "idle"
  | "connecting"
  | "speaking"
  | "listening"
  | "thinking"
  | "working"
  | "ended"
  | "error";

export type Levels = { bolo: number; mic: number };

type Props = {
  state: RobotState;
  getLevels?: () => Levels;
  onTap?: () => void;
  size?: number;
};

function cssColor(name: string, fallback: string): THREE.Color {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return new THREE.Color(v || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

const BASE: Record<RobotState, string> = {
  idle: "Idle",
  connecting: "Idle",
  speaking: "Idle",
  listening: "Idle",
  thinking: "Idle",
  working: "Dance",
  ended: "Idle",
  error: "Idle",
};
const ENTER_EMOTE: Partial<Record<RobotState, string>> = { connecting: "Wave", ended: "ThumbsUp", error: "No" };
const EXPRESSION: Partial<Record<RobotState, string>> = { listening: "Surprised", error: "Angry", thinking: "Sad" };

export default function BoloRobot({ state, getLevels, onTap, size = 170 }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<RobotState>(state);
  const levelsRef = useRef<() => Levels>(getLevels ?? (() => ({ bolo: 0, mic: 0 })));
  const tapRef = useRef<(() => void) | undefined>(onTap);
  stateRef.current = state;
  levelsRef.current = getLevels ?? (() => ({ bolo: 0, mic: 0 }));
  tapRef.current = onTap;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(dpr);
    renderer.setSize(size, size);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 1.2, 7);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.03);
    scene.environment = envRT.texture;

    const theme = {
      accent: cssColor("--color-accent", "#a5b4fc"),
      warn: cssColor("--color-warn", "#f0c062"),
      ok: cssColor("--color-ok", "#6fd3a0"),
      bad: cssColor("--color-bad", "#f08a80"),
    };
    const readTheme = () => {
      theme.accent = cssColor("--color-accent", "#a5b4fc");
      theme.warn = cssColor("--color-warn", "#f0c062");
      theme.ok = cssColor("--color-ok", "#6fd3a0");
      theme.bad = cssColor("--color-bad", "#f08a80");
    };
    const themeObs = new MutationObserver(readTheme);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    const phaseColor = (): THREE.Color =>
      stateRef.current === "speaking" ? theme.warn
        : stateRef.current === "ended" ? theme.ok
        : stateRef.current === "error" ? theme.bad
        : theme.accent;

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 6, 4);
    scene.add(key);
    const phaseLight = new THREE.PointLight(phaseColor().getHex(), 6, 14, 2);
    phaseLight.position.set(0, 2, 3);
    scene.add(phaseLight);

    // pivot we spin; the model is centred inside it
    const bot = new THREE.Group();
    scene.add(bot);

    let mixer: THREE.AnimationMixer | null = null;
    const actions = new Map<string, THREE.AnimationAction>();
    let currentBase: THREE.AnimationAction | null = null;
    let emoting = false;
    let face: THREE.Mesh | null = null;
    let exprTarget: string | null = null;
    let prevState: RobotState | null = null;
    let gestureClock = 0;

    const fadeToBase = (name: string) => {
      const next = actions.get(name);
      if (!next || next === currentBase) return;
      next.reset().fadeIn(0.3).play();
      if (currentBase) currentBase.fadeOut(0.3);
      currentBase = next;
    };
    const playEmote = (name: string) => {
      const a = actions.get(name);
      if (!a || !mixer) return;
      emoting = true;
      a.reset();
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.fadeIn(0.2).play();
      if (currentBase) currentBase.fadeOut(0.2);
    };

    const loader = new GLTFLoader();
    loader.load(
      "/models/RobotExpressive/RobotExpressive.glb",
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        // centre + ground, then fit the camera
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        model.position.sub(center);
        bot.add(model);
        const dist = (sphere.radius / Math.sin((camera.fov * Math.PI) / 180 / 2)) * 1.05;
        camera.position.set(0, sphere.radius * 0.15, dist);
        camera.lookAt(0, 0, 0);

        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.morphTargetDictionary && "Surprised" in m.morphTargetDictionary) face = m;
        });

        mixer = new THREE.AnimationMixer(model);
        gltf.animations.forEach((clip) => actions.set(clip.name, mixer!.clipAction(clip)));
        mixer.addEventListener("finished", () => {
          emoting = false;
          if (currentBase) currentBase.reset().fadeIn(0.25).play();
        });
        fadeToBase(BASE[stateRef.current]);
        currentBase?.play();
      },
      undefined,
      () => {
        /* model failed to load — the canvas just stays empty */
      },
    );

    // ── drag to rotate (+ tap detection + inertia) ──
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let downT = 0;
    let velY = 0;
    let idleSpin = true;
    let lastInteract = -999;

    const el = renderer.domElement;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      downT = performance.now();
      idleSpin = false;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
    };
    const onMoveEl = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      moved += Math.abs(dx);
      bot.rotation.y += dx * 0.012;
      velY = dx * 0.012;
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      el.style.cursor = "grab";
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      lastInteract = performance.now() / 1000;
      if (moved < 6 && performance.now() - downT < 350) {
        velY = 0;
        tapRef.current?.();
      }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMoveEl);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);

    const clock = new THREE.Clock();
    let raf = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const s = stateRef.current;
      const level = levelsRef.current();
      mixer?.update(dt);

      // phase transitions
      if (s !== prevState) {
        if (!emoting) fadeToBase(BASE[s]);
        const emote = ENTER_EMOTE[s];
        if (emote) playEmote(emote);
        exprTarget = EXPRESSION[s] ?? null;
        gestureClock = 0;
        prevState = s;
      }

      // gesture now and then while speaking, so it looks like it's talking
      if (s === "speaking" && !emoting) {
        gestureClock += dt;
        if (gestureClock > 2 + Math.random()) {
          gestureClock = 0;
          playEmote(Math.random() < 0.5 ? "Yes" : "Wave");
        }
      }

      // face expression blend
      if (face?.morphTargetInfluences && face.morphTargetDictionary) {
        const dict = face.morphTargetDictionary;
        for (const name of ["Surprised", "Angry", "Sad"]) {
          const idx = dict[name];
          if (idx === undefined) continue;
          const want = exprTarget === name ? 1 : 0;
          face.morphTargetInfluences[idx] += (want - face.morphTargetInfluences[idx]) * 0.15;
        }
      }

      // rotation inertia → gentle auto-spin
      if (!dragging) {
        bot.rotation.y += velY;
        velY *= 0.94;
        const since = t - (lastInteract < 0 ? -999 : lastInteract);
        if (Math.abs(velY) < 0.0008 && (idleSpin || since > 3)) {
          idleSpin = true;
          bot.rotation.y += dt * 0.3;
        }
      }

      // phase light: colour + pulse with loudness
      const pc = phaseColor();
      const beat =
        s === "speaking" ? 0.6 + level.bolo * 1.8
          : s === "listening" ? 0.5 + level.mic * 1.6
          : s === "connecting" || s === "working" ? 0.7 + Math.sin(t * 6) * 0.4
          : 0.55 + Math.sin(t * 2.2) * 0.25;
      phaseLight.color.copy(pc);
      phaseLight.intensity = 3 + beat * 4;

      renderer.render(scene, camera);
    };
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMoveEl);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      themeObs.disconnect();
      mixer?.stopAllAction();
      envRT.texture.dispose();
      pmrem.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = (m as THREE.Mesh).material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) (mat as THREE.Material).dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [size]);

  return <div ref={mountRef} style={{ width: size, height: size }} />;
}
