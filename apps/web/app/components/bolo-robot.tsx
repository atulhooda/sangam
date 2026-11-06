"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/*
 * Bolo, as a little robot. Pure three.js (no react-three-fiber) so it stays a
 * single self-contained canvas we can mount anywhere and drive from props.
 *
 * The head and antenna are real 3D (lit); the FACE is a 2D canvas painted every
 * frame and used as an unlit "screen" texture on the visor — that's what lets
 * the eyes blink, the mouth turn into a live waveform while Bolo speaks, and a
 * listening ring pulse with the mic. Everything recolours per phase and reads
 * the app's own CSS theme tokens, so it matches light and dark.
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
  /** Live loudness of Bolo's voice and the mic, 0..1, read every frame. */
  getLevels?: () => Levels;
  size?: number;
};

/** Read a --color-* token off :root and return [r,g,b] in 0..1, with a fallback. */
function cssColor(name: string, fallback: string): THREE.Color {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return new THREE.Color(v || fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

export default function BoloRobot({ state, getLevels, size = 150 }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  // Latest props the render loop reads without re-subscribing.
  const stateRef = useRef<RobotState>(state);
  const levelsRef = useRef<() => Levels>(getLevels ?? (() => ({ bolo: 0, mic: 0 })));
  stateRef.current = state;
  levelsRef.current = getLevels ?? (() => ({ bolo: 0, mic: 0 }));

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(dpr);
    renderer.setSize(size, size);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.15, 6.2);
    camera.lookAt(0, 0.1, 0);

    // ── theme palette (re-read on theme change) ──
    const theme = {
      accent: cssColor("--color-accent", "#a5b4fc"),
      warn: cssColor("--color-warn", "#f0c062"),
      ok: cssColor("--color-ok", "#6fd3a0"),
      bad: cssColor("--color-bad", "#f08a80"),
      shell: cssColor("--color-surface2", "#11132a"),
      ink: cssColor("--color-ink", "#e6e9f5"),
    };
    const readTheme = () => {
      theme.accent = cssColor("--color-accent", "#a5b4fc");
      theme.warn = cssColor("--color-warn", "#f0c062");
      theme.ok = cssColor("--color-ok", "#6fd3a0");
      theme.bad = cssColor("--color-bad", "#f08a80");
      theme.shell = cssColor("--color-surface2", "#11132a");
      theme.ink = cssColor("--color-ink", "#e6e9f5");
    };
    const themeObs = new MutationObserver(readTheme);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });

    // accent colour for the current phase
    const phaseColor = (): THREE.Color =>
      stateRef.current === "speaking"
        ? theme.warn
        : stateRef.current === "ended"
          ? theme.ok
          : stateRef.current === "error"
            ? theme.bad
            : theme.accent;

    // ── lights ──
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2.5, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(theme.accent.clone().getHex(), 1.4);
    rim.position.set(-3, 1, -2);
    scene.add(rim);
    const glowLight = new THREE.PointLight(theme.accent.clone().getHex(), 6, 10, 2);
    glowLight.position.set(0, 1.9, 0.6);
    scene.add(glowLight);

    // ── the robot ──
    const bot = new THREE.Group();
    scene.add(bot);

    const shellMat = new THREE.MeshStandardMaterial({ color: theme.shell.clone(), metalness: 0.55, roughness: 0.35 });
    const trimMat = new THREE.MeshStandardMaterial({ color: theme.ink.clone().multiplyScalar(0.5), metalness: 0.7, roughness: 0.3 });

    // head
    const head = new THREE.Group();
    head.position.y = 0.55;
    bot.add(head);
    const headGeo = new THREE.SphereGeometry(1.15, 48, 48);
    headGeo.scale(1.08, 0.92, 0.95);
    const headMesh = new THREE.Mesh(headGeo, shellMat);
    head.add(headMesh);

    // ears
    const earGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.18, 24);
    const earL = new THREE.Mesh(earGeo, trimMat);
    earL.rotation.z = Math.PI / 2;
    earL.position.set(-1.18, 0, 0);
    head.add(earL);
    const earR = earL.clone();
    earR.position.x = 1.18;
    head.add(earR);
    const earGlowMat = new THREE.MeshBasicMaterial({ color: phaseColor().clone() });
    const earDotGeo = new THREE.CircleGeometry(0.13, 24);
    const earDotL = new THREE.Mesh(earDotGeo, earGlowMat);
    earDotL.position.set(-1.28, 0, 0);
    earDotL.rotation.y = -Math.PI / 2;
    head.add(earDotL);
    const earDotR = new THREE.Mesh(earDotGeo, earGlowMat);
    earDotR.position.set(1.28, 0, 0);
    earDotR.rotation.y = Math.PI / 2;
    head.add(earDotR);

    // antenna
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.7, 16), trimMat);
    stalk.position.y = 1.2;
    head.add(stalk);
    const tipMat = new THREE.MeshBasicMaterial({ color: phaseColor().clone() });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 24), tipMat);
    tip.position.y = 1.62;
    head.add(tip);

    // ── face: a 2D canvas used as an unlit screen texture ──
    const FACE = 256;
    const faceCanvas = document.createElement("canvas");
    faceCanvas.width = FACE;
    faceCanvas.height = FACE;
    const fx = faceCanvas.getContext("2d")!;
    const faceTex = new THREE.CanvasTexture(faceCanvas);
    faceTex.colorSpace = THREE.SRGBColorSpace;
    const visorGeo = new THREE.PlaneGeometry(1.55, 1.1);
    const visorMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0.02, 0.92);
    head.add(visor);

    const hex = (c: THREE.Color) => `#${c.getHexString()}`;
    const rr = (x: number, y: number, w: number, h: number, r: number) => {
      fx.beginPath();
      fx.moveTo(x + r, y);
      fx.arcTo(x + w, y, x + w, y + h, r);
      fx.arcTo(x + w, y + h, x, y + h, r);
      fx.arcTo(x, y + h, x, y, r);
      fx.arcTo(x, y, x + w, y, r);
      fx.closePath();
    };

    // blink timing
    let nextBlink = 1.5 + Math.random() * 3;
    let blink = 0; // 0 open .. 1 shut

    function drawFace(t: number, dt: number, level: Levels) {
      const s = stateRef.current;
      const col = hex(phaseColor());
      fx.clearRect(0, 0, FACE, FACE);
      // visor background
      fx.fillStyle = "rgba(6,7,16,0.92)";
      rr(14, 30, FACE - 28, FACE - 86, 46);
      fx.fill();
      fx.strokeStyle = col;
      fx.globalAlpha = 0.35;
      fx.lineWidth = 3;
      fx.stroke();
      fx.globalAlpha = 1;

      fx.save();
      fx.shadowColor = col;
      fx.shadowBlur = 22;
      fx.fillStyle = col;
      fx.strokeStyle = col;

      const cx = FACE / 2;
      const eyeY = 108;

      if (s === "error") {
        // ✕ eyes
        fx.lineWidth = 9;
        fx.lineCap = "round";
        for (const ex of [cx - 44, cx + 44]) {
          fx.beginPath();
          fx.moveTo(ex - 15, eyeY - 15);
          fx.lineTo(ex + 15, eyeY + 15);
          fx.moveTo(ex + 15, eyeY - 15);
          fx.lineTo(ex - 15, eyeY + 15);
          fx.stroke();
        }
        fx.lineWidth = 7;
        fx.beginPath();
        fx.moveTo(cx - 26, 182);
        fx.lineTo(cx + 26, 182);
        fx.stroke();
        fx.restore();
        faceTex.needsUpdate = true;
        return;
      }

      // eyes (blink): advance blink clock
      nextBlink -= dt;
      if (blink === 0 && nextBlink <= 0) blink = 0.0001;
      if (blink > 0) {
        blink += dt * 9;
        if (blink >= 2) {
          blink = 0;
          nextBlink = 1.8 + Math.random() * 3.5;
        }
      }
      const open = 1 - (blink > 1 ? 2 - blink : blink); // 1→0→1
      // look direction: up when thinking
      const lookY = s === "thinking" ? -14 : 0;
      const eh = Math.max(2, 30 * open);
      for (const ex of [cx - 44, cx + 44]) {
        rr(ex - 14, eyeY - eh / 2 + lookY, 28, eh, Math.min(14, eh / 2));
        fx.fill();
      }

      // mouth / activity
      if (s === "speaking") {
        const n = 7;
        const amp = 0.25 + level.bolo * 0.75;
        for (let i = 0; i < n; i++) {
          const bx = cx - (n - 1) * 9 + i * 18;
          const phase = t * 11 + i * 0.9;
          const h = 8 + Math.abs(Math.sin(phase)) * 46 * amp;
          rr(bx - 5, 182 - h / 2, 10, h, 5);
          fx.fill();
        }
      } else if (s === "listening") {
        const pr = 10 + level.mic * 26 + Math.sin(t * 4) * 3;
        fx.globalAlpha = 0.9;
        fx.lineWidth = 5;
        fx.beginPath();
        fx.arc(cx, 184, pr, 0, Math.PI * 2);
        fx.stroke();
        fx.globalAlpha = 0.5;
        fx.beginPath();
        fx.arc(cx, 184, pr + 10, 0, Math.PI * 2);
        fx.stroke();
        fx.globalAlpha = 1;
      } else if (s === "thinking" || s === "connecting" || s === "working") {
        for (let i = 0; i < 3; i++) {
          const a = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 5 - i * 0.9));
          fx.globalAlpha = a;
          fx.beginPath();
          fx.arc(cx - 26 + i * 26, 184, 7, 0, Math.PI * 2);
          fx.fill();
        }
        fx.globalAlpha = 1;
      } else {
        // idle / ended: soft smile
        fx.lineWidth = 7;
        fx.lineCap = "round";
        fx.beginPath();
        fx.arc(cx, 168, 26, 0.15 * Math.PI, 0.85 * Math.PI);
        fx.stroke();
      }
      fx.restore();
      faceTex.needsUpdate = true;
    }

    // ── pointer follow (subtle) ──
    const target = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      target.x = (e.clientX / window.innerWidth) * 2 - 1;
      target.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove);

    // ── animation loop ──
    const clock = new THREE.Clock();
    let raf = 0;
    const tmp = new THREE.Color();

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      const s = stateRef.current;
      const level = levelsRef.current();

      // body bob + breathing
      const busy = s === "connecting" || s === "working";
      const speed = busy ? 3.2 : 1.4;
      bot.position.y = Math.sin(t * speed) * (busy ? 0.08 : 0.05);
      bot.scale.setScalar(1 + Math.sin(t * speed * 2) * 0.012);

      // head: follow pointer, lean in when listening, nod when speaking
      const leanX = s === "listening" ? 0.12 : 0;
      const nod = s === "speaking" ? Math.sin(t * 9) * 0.05 * (0.4 + level.bolo) : 0;
      head.rotation.y += (target.x * 0.5 - head.rotation.y) * 0.06;
      head.rotation.x += (target.y * 0.3 + leanX + nod - head.rotation.x) * 0.08;

      // antenna sway + spin while busy
      head.children.forEach(() => {});
      stalk.rotation.z = Math.sin(t * 2) * 0.08;
      if (busy) bot.rotation.y += dt * 1.4;
      else bot.rotation.y += (0 - bot.rotation.y) * 0.05;

      // phase colour → antenna tip, ears, rim/glow light
      const pc = phaseColor();
      const pulse =
        s === "speaking" ? 0.55 + level.bolo * 0.9 : s === "listening" ? 0.5 + level.mic * 0.9 : 0.6 + Math.sin(t * 3) * 0.25;
      tmp.copy(pc).multiplyScalar(Math.min(1.6, pulse));
      (tip.material as THREE.MeshBasicMaterial).color.copy(tmp);
      (earGlowMat as THREE.MeshBasicMaterial).color.copy(tmp);
      glowLight.color.copy(pc);
      glowLight.intensity = 3 + pulse * 4;
      glowLight.position.copy(tip.position).applyMatrix4(head.matrixWorld);
      rim.color.copy(pc).multiplyScalar(0.6);

      drawFace(t, dt, level);
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      themeObs.disconnect();
      renderer.dispose();
      headGeo.dispose();
      earGeo.dispose();
      earDotGeo.dispose();
      visorGeo.dispose();
      faceTex.dispose();
      shellMat.dispose();
      trimMat.dispose();
      visorMat.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [size]);

  return <div ref={mountRef} style={{ width: size, height: size }} aria-hidden />;
}
