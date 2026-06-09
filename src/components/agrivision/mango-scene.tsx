"use client";

// 3D mango cluster with a live AI-scan visualization — procedural branch with
// 3 mangoes + leaves, soft warm lighting, drag-to-rotate, gentle auto-orbit,
// and an HTML overlay that draws detection bounding boxes in screen-space.

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";

type Box = {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
  stage: "Tree-Ripe" | "Breaking" | "Green";
  show: boolean;
};

const STAGE_COLOR: Record<Box["stage"], string> = {
  "Tree-Ripe": "#E89B3C",
  "Breaking": "#C9A24A",
  "Green": "#4A6F4F",
};

export function MangoScene({ className }: { className?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [scanProgress, setScanProgress] = useState(0);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ── Scene / camera / renderer ───────────────────────────────────────
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xf1e9d2, 0.06);

    const w = mount.clientWidth;
    const h = mount.clientHeight;
    const camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 100);
    camera.position.set(0, 0.3, 6.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    // ── Lights — warm key, cool fill, gold rim ──────────────────────────
    scene.add(new THREE.AmbientLight(0xfff1d6, 0.45));
    const key = new THREE.DirectionalLight(0xffe5b8, 1.4);
    key.position.set(3, 5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xb8c8a8, 0.35);
    fill.position.set(-4, 2, -2);
    scene.add(fill);
    const rim = new THREE.PointLight(0xd4af6a, 1.0, 12);
    rim.position.set(-2, 1, -3);
    scene.add(rim);

    // ── Root group (rotates) ─────────────────────────────────────────────
    const root = new THREE.Group();
    scene.add(root);

    // ── Branch (curved tube) ─────────────────────────────────────────────
    const branchCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-2.5, 1.6, -0.4),
      new THREE.Vector3(-1.4, 1.0, 0.1),
      new THREE.Vector3(-0.4, 0.4, 0.0),
      new THREE.Vector3(0.6, -0.1, -0.1),
      new THREE.Vector3(1.6, -0.4, 0.2),
    ]);
    const branchMat = new THREE.MeshStandardMaterial({
      color: 0x6b4a2c, roughness: 0.85, metalness: 0.05,
    });
    const branch = new THREE.Mesh(new THREE.TubeGeometry(branchCurve, 64, 0.07, 12, false), branchMat);
    branch.castShadow = true;
    root.add(branch);

    function addStem(from: THREE.Vector3, to: THREE.Vector3) {
      const c = new THREE.CatmullRomCurve3([from, to.clone().lerp(from, 0.5).add(new THREE.Vector3(0, 0.05, 0)), to]);
      const m = new THREE.Mesh(new THREE.TubeGeometry(c, 12, 0.018, 8, false), branchMat);
      m.castShadow = true;
      root.add(m);
    }

    // ── Mango factory — procedural lathe shape + canvas gradient skin ───
    function makeMangoMat(ripeness: number) {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 256;
      const ctx = c.getContext("2d")!;
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0.0, `hsl(${88 - ripeness * 18}, ${45 - ripeness * 20}%, ${40 + ripeness * 8}%)`);
      g.addColorStop(0.45, `hsl(${52 - ripeness * 22}, ${60 + ripeness * 12}%, ${48 + ripeness * 8}%)`);
      g.addColorStop(0.8, `hsl(${30 - ripeness * 6}, ${65 + ripeness * 20}%, ${55 + ripeness * 6}%)`);
      g.addColorStop(1.0, `hsl(${10 + (1 - ripeness) * 10}, 75%, ${52 + ripeness * 4}%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = "rgba(60,40,20,0.18)";
      for (let i = 0; i < 80; i++) {
        ctx.beginPath();
        ctx.arc(Math.random() * 64, 30 + Math.random() * 220, Math.random() * 0.9 + 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.set(1, 1);
      return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05 });
    }

    function makeMango(ripeness = 0.6, scale = 1) {
      const pts: THREE.Vector2[] = [];
      const segs = 24;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const base = Math.sin(Math.PI * (t * 0.92 + 0.04));
        let r = base;
        r *= 1 - 0.18 * Math.pow(t, 2.6);
        r *= 1 + 0.05 * Math.sin(t * 8.0);
        r *= 0.55;
        pts.push(new THREE.Vector2(Math.max(r, 0.005), (t - 0.5) * 1.7));
      }
      const geo = new THREE.LatheGeometry(pts, 32);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        pos.setZ(i, z * 0.78);
        pos.setX(i, x + y * 0.04);
      }
      geo.computeVertexNormals();
      const mango = new THREE.Mesh(geo, makeMangoMat(ripeness));
      mango.scale.setScalar(scale);
      mango.castShadow = true;
      mango.receiveShadow = true;
      return mango;
    }

    // ── Leaf factory ─────────────────────────────────────────────────────
    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, 0);
    leafShape.bezierCurveTo(0.05, 0.25, 0.18, 0.55, 0, 1.0);
    leafShape.bezierCurveTo(-0.18, 0.55, -0.05, 0.25, 0, 0);
    const leafGeo = new THREE.ShapeGeometry(leafShape, 16);
    {
      const pos = leafGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        const curl = Math.sin(y * Math.PI) * 0.06;
        pos.setZ(i, curl - Math.abs(x) * 0.18);
      }
      leafGeo.computeVertexNormals();
    }
    const leafMatA = new THREE.MeshStandardMaterial({ color: 0x3d6b3b, roughness: 0.6, side: THREE.DoubleSide });
    const leafMatB = new THREE.MeshStandardMaterial({ color: 0x4f7b3f, roughness: 0.6, side: THREE.DoubleSide });

    function addLeaf(pos: THREE.Vector3, rot: THREE.Vector3, scale = 0.7, dark = false) {
      const m = new THREE.Mesh(leafGeo, dark ? leafMatA : leafMatB);
      m.position.copy(pos);
      m.rotation.set(rot.x, rot.y, rot.z);
      m.scale.setScalar(scale);
      m.castShadow = true;
      root.add(m);
    }

    // ── Compose: 3 mangoes hanging on stems, several leaves ─────────────
    const mangoConfig: { pos: [number, number, number]; ripeness: number; scale: number; stage: Box["stage"]; confidence: number }[] = [
      { pos: [-0.4, -0.5, 0.2], ripeness: 0.85, scale: 0.95, stage: "Tree-Ripe", confidence: 0.94 },
      { pos: [0.6, -0.8, -0.1], ripeness: 0.55, scale: 0.85, stage: "Breaking", confidence: 0.89 },
      { pos: [1.4, -1.0, 0.25], ripeness: 0.30, scale: 0.78, stage: "Green", confidence: 0.91 },
    ];

    const mangoMeshes = mangoConfig.map((cfg, i) => {
      const m = makeMango(cfg.ripeness, cfg.scale);
      m.position.set(...cfg.pos);
      m.rotation.z = (i - 1) * 0.08;
      m.rotation.x = Math.sin(i * 1.3) * 0.18;
      root.add(m);

      const top = new THREE.Vector3(cfg.pos[0], cfg.pos[1] + cfg.scale * 0.78, cfg.pos[2]);
      let best: THREE.Vector3 | null = null;
      let bestD = Infinity;
      for (let t = 0; t <= 1; t += 0.02) {
        const p = branchCurve.getPoint(t);
        const d = p.distanceTo(top);
        if (d < bestD) { bestD = d; best = p.clone(); }
      }
      if (best) addStem(best, top);

      return { mesh: m, ...cfg };
    });

    const leafSpots: { t: number; off: [number, number, number]; rot: [number, number, number]; scale: number; dark: boolean }[] = [
      { t: 0.08, off: [0.10, 0.25, 0.15], rot: [-1.1, 0.5, 0.4], scale: 0.85, dark: false },
      { t: 0.15, off: [-0.05, 0.30, -0.20], rot: [-0.9, -0.6, 0.1], scale: 0.95, dark: true },
      { t: 0.28, off: [0.20, 0.15, 0.25], rot: [-1.2, 0.8, 0.5], scale: 0.78, dark: false },
      { t: 0.40, off: [-0.15, 0.30, -0.05], rot: [-1.0, -0.2, -0.4], scale: 0.92, dark: true },
      { t: 0.55, off: [0.05, 0.30, 0.30], rot: [-1.1, 0.5, 0.3], scale: 0.80, dark: false },
      { t: 0.70, off: [-0.18, 0.10, -0.25], rot: [-1.3, -0.7, -0.2], scale: 0.86, dark: true },
      { t: 0.82, off: [0.10, 0.20, 0.18], rot: [-1.05, 0.3, 0.6], scale: 0.74, dark: false },
      { t: 0.92, off: [0.05, 0.30, -0.05], rot: [-1.2, 0.0, 0.0], scale: 0.95, dark: true },
    ];
    leafSpots.forEach(s => {
      const base = branchCurve.getPoint(s.t);
      const p = new THREE.Vector3(base.x + s.off[0], base.y + s.off[1], base.z + s.off[2]);
      addLeaf(p, new THREE.Vector3(...s.rot), s.scale, s.dark);
    });

    // ── Ground shadow disc ───────────────────────────────────────────────
    const shadowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(2.5, 32),
      new THREE.MeshBasicMaterial({ color: 0x0e1f14, transparent: true, opacity: 0.10 }),
    );
    shadowDisc.position.set(0.4, -2.1, 0);
    shadowDisc.rotation.x = -Math.PI / 2;
    scene.add(shadowDisc);

    // ── Interaction: drag rotate + gentle auto-orbit ────────────────────
    const target = { rx: 0, ry: 0 };
    const current = { rx: 0, ry: 0 };
    let dragging = false;
    let lastX = 0, lastY = 0;
    let autoSpin = true;
    let autoT = 0;

    const getPoint = (e: MouseEvent | TouchEvent) => ("touches" in e ? e.touches[0] : e);
    const onDown = (e: MouseEvent | TouchEvent) => {
      dragging = true; autoSpin = false;
      const p = getPoint(e);
      lastX = p.clientX; lastY = p.clientY;
      mount.style.cursor = "grabbing";
    };
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging) return;
      const p = getPoint(e);
      const dx = (p.clientX - lastX) / mount.clientWidth;
      const dy = (p.clientY - lastY) / mount.clientHeight;
      target.ry += dx * 3.2;
      target.rx += dy * 1.6;
      target.rx = Math.max(-0.7, Math.min(0.7, target.rx));
      lastX = p.clientX; lastY = p.clientY;
    };
    const onUp = () => { dragging = false; mount.style.cursor = "grab"; };

    mount.style.cursor = "grab";
    mount.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    mount.addEventListener("touchstart", onDown, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onUp);

    // ── Render loop + overlay box projection ────────────────────────────
    const v = new THREE.Vector3();
    let last = performance.now();
    let rafId = 0;
    let scanT = 0;
    let frameCount = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      frameCount++;

      if (autoSpin) {
        autoT += dt;
        target.ry = autoT * 0.18;
        target.rx = Math.sin(autoT * 0.4) * 0.12 - 0.05;
      }
      current.rx += (target.rx - current.rx) * 0.08;
      current.ry += (target.ry - current.ry) * 0.08;
      root.rotation.x = current.rx;
      root.rotation.y = current.ry;

      scanT += dt * 0.18;
      if (scanT > 1.4) scanT = 0;

      // Throttle React state updates to ~12 Hz — 3D keeps rendering every frame.
      if (frameCount % 5 === 0) {
        setScanProgress(Math.min(1, scanT));

        const W = mount.clientWidth, H = mount.clientHeight;
        const newBoxes: Box[] = mangoMeshes.map((m, i) => {
          m.mesh.getWorldPosition(v);
          v.project(camera);
          const sx = (v.x + 1) / 2 * W;
          const sy = (1 - (v.y + 1) / 2) * H;
          const z = v.z;
          const scalePx = Math.max(38, (1 - z) * 90 * m.scale);
          const order = [0, 2, 1][i] ?? i;
          const revealAt = order * 0.28 + 0.1;
          return {
            left: sx - scalePx / 2,
            top: sy - scalePx * 0.55,
            width: scalePx,
            height: scalePx * 1.15,
            label: `${m.stage} · ${m.confidence.toFixed(2)}`,
            stage: m.stage,
            show: scanT >= revealAt,
          };
        });
        setBoxes(newBoxes);
      }

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    const onResize = () => {
      const nw = mount.clientWidth, nh = mount.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      mount.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      mount.removeEventListener("touchstart", onDown);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      try { mount.removeChild(renderer.domElement); } catch {}
      renderer.dispose();
    };
  }, []);

  return (
    <div className={cn(
      "relative w-full aspect-[1/1.05] rounded-3xl border border-border overflow-hidden bg-card",
      "before:absolute before:inset-0 before:pointer-events-none before:content-['']",
      "before:bg-[radial-gradient(ellipse_80%_60%_at_50%_40%,hsl(var(--primary)/0.12),transparent_70%)]",
      className,
    )}>
      <div ref={mountRef} className="absolute inset-0 [&>canvas]:block [&>canvas]:w-full [&>canvas]:h-full" />

      {/* Detection overlay */}
      <div className="absolute inset-0 pointer-events-none">
        {boxes.map((b, i) => (
          <div
            key={i}
            className="absolute rounded transition-[opacity,left,top,width,height] duration-200 ease-linear"
            style={{
              left: b.left, top: b.top, width: b.width, height: b.height,
              border: `1.5px solid ${STAGE_COLOR[b.stage]}`,
              opacity: b.show ? 1 : 0,
              transitionProperty: "opacity, left, top, width, height",
              transitionDuration: "400ms, 200ms, 200ms, 200ms, 200ms",
              boxShadow: b.show ? "0 0 0 1px rgba(241,233,210,0.4)" : "none",
            }}
          >
            <span
              className="absolute whitespace-nowrap rounded-tl rounded-tr rounded-br px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
              style={{
                top: -22, left: -1.5,
                background: STAGE_COLOR[b.stage],
                color: b.stage === "Green" ? "#F1E9D2" : "#0E1F14",
                fontFamily: "var(--font-body, 'DM Sans'), sans-serif",
              }}
            >
              {b.label}
            </span>
            {/* Crosshair corners */}
            <span className="absolute -left-[3px] -top-[3px] h-1.5 w-1.5 border-t-2 border-l-2" style={{ borderColor: "#F1E9D2" }} />
            <span className="absolute -right-[3px] -top-[3px] h-1.5 w-1.5 border-t-2 border-r-2" style={{ borderColor: "#F1E9D2" }} />
            <span className="absolute -left-[3px] -bottom-[3px] h-1.5 w-1.5 border-b-2 border-l-2" style={{ borderColor: "#F1E9D2" }} />
            <span className="absolute -right-[3px] -bottom-[3px] h-1.5 w-1.5 border-b-2 border-r-2" style={{ borderColor: "#F1E9D2" }} />
          </div>
        ))}

        {/* Scan beam */}
        <div
          className="absolute inset-y-0 w-[1.5px] transition-opacity duration-300"
          style={{
            left: `${scanProgress * 100}%`,
            background: "linear-gradient(to bottom, transparent, #E89B3C, transparent)",
            boxShadow: "0 0 12px 2px rgba(232,155,60,0.4)",
            opacity: scanProgress > 0.05 && scanProgress < 0.98 ? 0.55 : 0,
          }}
        />
      </div>

      {/* Corner ticks */}
      <span className="absolute left-3 top-3 h-4 w-4 border-t border-l border-foreground/20 rounded-tl" />
      <span className="absolute right-3 top-3 h-4 w-4 border-t border-r border-foreground/20 rounded-tr" />
      <span className="absolute left-3 bottom-3 h-4 w-4 border-b border-l border-foreground/20 rounded-bl" />
      <span className="absolute right-3 bottom-3 h-4 w-4 border-b border-r border-foreground/20 rounded-br" />

      {/* Meta readout */}
      <div className="absolute left-5 right-5 top-5 flex items-start justify-between pointer-events-none">
        <div className="text-[0.65rem] uppercase tracking-[0.22em] text-muted-foreground">
          Live · Gemini Vision
          <span className="block mt-1 text-[0.75rem] text-foreground normal-case tracking-normal font-headline italic">Block A · East row</span>
        </div>
        <div className="text-[0.65rem] uppercase tracking-[0.22em] text-muted-foreground text-right">
          06:14 IST
          <span className="block mt-1 text-[0.75rem] text-foreground normal-case tracking-normal font-headline italic">{boxes.filter(b => b.show).length} / {boxes.length} detected</span>
        </div>
      </div>

      {/* Drag hint */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground/70">
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#E89B3C", boxShadow: "0 0 6px #E89B3C" }} />
        Drag to rotate
      </div>
    </div>
  );
}
