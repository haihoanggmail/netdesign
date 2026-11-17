/**
 * Runtime của trình xem 3D độc lập (chạy bên trong file .html xuất ra).
 *
 * File này KHÔNG được import từ code ứng dụng. Nó được bundle thành 1 khối IIFE bởi
 * `scripts/build-viewer3d.mjs` -> `src/generated/viewer3dRuntime.generated.ts`,
 * rồi nhúng nguyên văn vào HTML để file mở được offline, không cần mạng / phần mềm.
 *
 * Dữ liệu cảnh nằm trong <script type="application/json" id="hachihi-3d-data">.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createFrameLoop } from './frameLoop';
import { firstVisibleHit } from './visibility';

type PresetId = 'iso' | 'top' | 'front' | 'side';

interface Pose {
  position: [number, number, number];
  target: [number, number, number];
}

interface ViewerPayload {
  scene: {
    sceneJson: Record<string, unknown>;
    isDark: boolean;
    background: number;
    fogDensity: number;
    environmentIntensity: number;
    toneMappingExposure: number;
    camera: {
      fov: number;
      near: number;
      far: number;
      minDistance: number;
      maxDistance: number;
      maxPolarAngle: number;
    };
    presets: Record<PresetId, Pose>;
  };
  /** nodeId -> thông tin hiển thị khi bấm vào thiết bị. */
  nodeInfo: Record<string, Array<[string, string]>>;
  /** cableId -> thông tin hiển thị khi bấm vào cáp. */
  cableInfo: Record<string, Array<[string, string]>>;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Thiếu phần tử #${id}`);
  return el as T;
};

function showFatal(message: string): void {
  const box = document.getElementById('v3d-fatal');
  const loading = document.getElementById('v3d-loading');
  if (loading) loading.style.display = 'none';
  if (box) {
    box.textContent = message;
    box.style.display = 'flex';
  }
}

function readPayload(): ViewerPayload {
  const el = document.getElementById('hachihi-3d-data');
  if (!el || !el.textContent) throw new Error('Không tìm thấy dữ liệu mô hình 3D trong file.');
  return JSON.parse(el.textContent) as ViewerPayload;
}

/** Màu nền cảnh theo giao diện (khớp phần mềm chính). */
const BG_DARK = 0x0b1120;
const BG_LIGHT = 0xeef4fb;

/**
 * Three.js >= r163 chỉ hỗ trợ WebGL 2. Chỉ kiểm tra sự tồn tại của API (không tạo canvas/context thử
 * nghiệm — tránh rò rỉ context); lỗi khởi tạo thực sự được bắt riêng khi tạo renderer.
 */
function hasWebGl2Api(): boolean {
  return typeof (window as unknown as { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext !== 'undefined';
}

async function boot(): Promise<void> {
  if (!hasWebGl2Api()) {
    showFatal('Trình duyệt này không hỗ trợ WebGL 2 nên không thể hiển thị mô hình 3D. Hãy dùng Chrome / Edge / Firefox / Safari bản mới (từ 2021 trở lên).');
    return;
  }

  const payload = readPayload();
  const cfg = payload.scene;
  const stage = $('v3d-stage');

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  } catch (err) {
    showFatal(
      'Trình duyệt có WebGL 2 nhưng không khởi tạo được bộ kết xuất (GPU/driver bị tắt, bị chặn hoặc hết tài nguyên). ' +
        'Hãy bật tăng tốc phần cứng, đóng bớt tab rồi tải lại. Chi tiết: ' +
        (err instanceof Error ? err.message : String(err))
    );
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = cfg.toneMappingExposure || 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
  renderer.domElement.tabIndex = 0;
  stage.appendChild(renderer.domElement);

  // Dựng lại scene từ JSON (texture canvas được nhúng dạng data URL nên cần parseAsync).
  const loader = new THREE.ObjectLoader();
  const loaded = (await loader.parseAsync(cfg.sceneJson)) as THREE.Scene;
  const scene = loaded;

  // Môi trường phản chiếu (giống phần mềm) + nền + sương mù. Dựng qua hàm để dựng lại sau khi mất context.
  const buildEnvironment = () => {
    const old = scene.environment;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    scene.environment = pmrem.fromScene(roomEnv, 0.04).texture;
    scene.environmentIntensity = cfg.environmentIntensity;
    roomEnv.dispose();
    pmrem.dispose();
    old?.dispose();
  };
  buildEnvironment();
  scene.background = new THREE.Color(cfg.background);
  scene.fog = new THREE.FogExp2(cfg.background, cfg.fogDensity);
  const applySceneTheme = (dark: boolean) => {
    const hex = dark ? BG_DARK : BG_LIGHT;
    (scene.background as THREE.Color).setHex(hex);
    (scene.fog as THREE.FogExp2).color.setHex(hex);
  };

  // Camera + điều khiển quỹ đạo.
  const camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1, cfg.camera.near, cfg.camera.far);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.minDistance = cfg.camera.minDistance;
  controls.maxDistance = cfg.camera.maxDistance;
  // Cho phép nhìn đến sát mặt sàn nhưng không chui xuống dưới sàn.
  controls.maxPolarAngle = cfg.camera.maxPolarAngle;
  controls.rotateSpeed = 0.9;
  controls.zoomSpeed = 1.0;
  controls.panSpeed = 0.9;

  const applyPose = (pose: Pose) => {
    camera.position.set(...pose.position);
    controls.target.set(...pose.target);
    controls.update();
  };
  applyPose(cfg.presets.iso);

  // ---- Vòng lặp render theo yêu cầu: tối đa 1 RAF đang chờ (xem frameLoop.ts) ----
  let animFrom: { pos: THREE.Vector3; tgt: THREE.Vector3 } | null = null;
  let animTo: { pos: THREE.Vector3; tgt: THREE.Vector3 } | null = null;
  let animT = 0;
  let autoRotate = false;

  const makeLoop = () => createFrameLoop({
    raf: cb => requestAnimationFrame(cb),
    cancel: id => cancelAnimationFrame(id),
    now: () => performance.now(),
    update: dt => {
      let animating = false;
      if (animFrom && animTo) {
        animT = Math.min(1, animT + dt / 0.55);
        const k = 1 - Math.pow(1 - animT, 3); // easeOutCubic
        camera.position.lerpVectors(animFrom.pos, animTo.pos, k);
        controls.target.lerpVectors(animFrom.tgt, animTo.tgt, k);
        if (animT >= 1) {
          animFrom = null;
          animTo = null;
        } else {
          animating = true;
        }
      }
      controls.autoRotate = autoRotate;
      controls.autoRotateSpeed = 1.6;
      const changed = controls.update(dt);
      return { changed, animating: animating || autoRotate };
    },
    render: () => renderer.render(scene, camera)
  });
  let loop = makeLoop();
  let ctxLost = false;
  const request = () => {
    if (!ctxLost) loop.request();
  };
  controls.addEventListener('change', request);

  // Cho E2E/kiểm tra hiệu năng: số RAF đang chờ phải luôn ≤ 1, và = 0 khi đứng yên.
  (window as unknown as Record<string, unknown>).__hachihiViewer3D = {
    get pendingRaf() {
      return loop.pending ? 1 : 0;
    },
    get frames() {
      return loop.frames;
    },
    get autoRotate() {
      return autoRotate;
    },
    get contextLost() {
      return ctxLost;
    },
    get background() {
      return (scene.background as THREE.Color).getHex();
    },
    get cablesVisible() {
      return cableMeshes.length > 0 && cableMeshes.every(o => o.visible);
    },
    get labelsVisible() {
      return spriteObjs.length > 0 && spriteObjs.every(o => o.visible);
    }
  };

  const flyTo = (pose: Pose) => {
    animFrom = { pos: camera.position.clone(), tgt: controls.target.clone() };
    animTo = { pos: new THREE.Vector3(...pose.position), tgt: new THREE.Vector3(...pose.target) };
    animT = 0;
    request();
  };

  const resize = () => {
    const w = Math.max(1, stage.clientWidth);
    const h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    request();
  };
  new ResizeObserver(resize).observe(stage);
  window.addEventListener('resize', resize);
  resize();

  // ---- Nhóm đối tượng để bật/tắt ----
  const cableMeshes: THREE.Object3D[] = [];
  const spriteObjs: THREE.Object3D[] = [];
  const pickables: THREE.Object3D[] = [];
  scene.traverse(o => {
    const ud = o.userData || {};
    if (o instanceof THREE.Sprite) spriteObjs.push(o);
    if (o instanceof THREE.Mesh && ud.cableId) cableMeshes.push(o);
    if (o instanceof THREE.Mesh && (ud.nodeId || ud.cableId)) pickables.push(o);
  });

  // ---- Toolbar ----
  const presetBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-preset]'));
  const setActivePreset = (id: PresetId | null) => {
    presetBtns.forEach(b => b.classList.toggle('active', b.dataset.preset === id));
  };
  presetBtns.forEach(b =>
    b.addEventListener('click', () => {
      const id = b.dataset.preset as PresetId;
      autoRotate = false;
      $('v3d-auto').classList.remove('active');
      flyTo(cfg.presets[id]);
      setActivePreset(id);
    })
  );
  setActivePreset('iso');
  controls.addEventListener('start', () => setActivePreset(null));

  const toggle = (btnId: string, apply: (on: boolean) => void, initial = true) => {
    const btn = $(btnId);
    let on = initial;
    btn.classList.toggle('active', on);
    btn.addEventListener('click', () => {
      on = !on;
      btn.classList.toggle('active', on);
      apply(on);
      request();
    });
  };
  toggle('v3d-cables', on => {
    cableMeshes.forEach(o => (o.visible = on));
    if (!on) {
      tip.style.display = 'none';
      if (infoIsCable) info.style.display = 'none';
    }
  });
  toggle('v3d-labels', on => spriteObjs.forEach(o => (o.visible = on)));
  toggle('v3d-auto', on => {
    autoRotate = on;
  }, false);

  $('v3d-reset').addEventListener('click', () => {
    autoRotate = false;
    $('v3d-auto').classList.remove('active');
    flyTo(cfg.presets.iso);
    setActivePreset('iso');
  });

  const dolly = (factor: number) => {
    const dir = camera.position.clone().sub(controls.target);
    const dist = THREE.MathUtils.clamp(dir.length() * factor, controls.minDistance, controls.maxDistance);
    dir.setLength(dist);
    camera.position.copy(controls.target).add(dir);
    controls.update();
    request();
  };
  $('v3d-zoom-in').addEventListener('click', () => dolly(0.8));
  $('v3d-zoom-out').addEventListener('click', () => dolly(1.25));

  $('v3d-shot').addEventListener('click', () => {
    if (ctxLost) return;
    renderer.render(scene, camera);
    const a = document.createElement('a');
    a.href = renderer.domElement.toDataURL('image/png');
    a.download = 'hachihi-3d-view.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  $('v3d-theme').addEventListener('click', () => {
    const dark = document.body.classList.toggle('dark');
    applySceneTheme(dark); // đổi cả nền + sương mù cảnh 3D, không chỉ CSS bảng điều khiển
    request();
  });
  if (document.body.classList.contains('dark')) applySceneTheme(true);

  $('v3d-full').addEventListener('click', () => {
    const root = $('v3d-root');
    if (!document.fullscreenElement) root.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  });

  // Phím tắt: 1-4 = góc nhìn, R = đặt lại, A = tự xoay, +/- = zoom
  renderer.domElement.addEventListener('keydown', e => {
    const map: Record<string, PresetId> = { '1': 'iso', '2': 'top', '3': 'front', '4': 'side' };
    if (map[e.key]) {
      flyTo(cfg.presets[map[e.key]]);
      setActivePreset(map[e.key]);
    } else if (e.key === 'r' || e.key === 'R') $('v3d-reset').click();
    else if (e.key === 'a' || e.key === 'A') $('v3d-auto').click();
    else if (e.key === '+' || e.key === '=') dolly(0.8);
    else if (e.key === '-') dolly(1.25);
  });

  // ---- Rê chuột / bấm để xem thông tin ----
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tip = $('v3d-tip');
  const info = $('v3d-info');
  let infoIsCable = false;
  let downX = 0;
  let downY = 0;

  const pick = (clientX: number, clientY: number): THREE.Object3D | null => {
    if (ctxLost) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    // Raycaster không tự bỏ qua visible=false -> lọc theo hiển thị hiệu lực (kể cả nhóm cha).
    const hit = firstVisibleHit(raycaster.intersectObjects(pickables, false));
    return hit ? hit.object : null;
  };

  renderer.domElement.addEventListener('pointermove', e => {
    if (e.buttons) {
      tip.style.display = 'none';
      return;
    }
    const hit = pick(e.clientX, e.clientY);
    const label = hit && (hit.userData.label as string | undefined);
    if (label) {
      tip.textContent = label;
      tip.style.display = 'block';
      tip.style.left = `${e.clientX + 14}px`;
      tip.style.top = `${e.clientY + 14}px`;
      renderer.domElement.style.cursor = 'pointer';
    } else {
      tip.style.display = 'none';
      renderer.domElement.style.cursor = '';
    }
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    tip.style.display = 'none';
  });

  renderer.domElement.addEventListener('pointerdown', e => {
    downX = e.clientX;
    downY = e.clientY;
    renderer.domElement.focus({ preventScroll: true });
  });
  renderer.domElement.addEventListener('pointerup', e => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // là thao tác kéo, không phải bấm
    const hit = pick(e.clientX, e.clientY);
    if (!hit) {
      info.style.display = 'none';
      return;
    }
    const ud = hit.userData as { nodeId?: string; cableId?: string; label?: string };
    const rows = (ud.nodeId && payload.nodeInfo[ud.nodeId]) || (ud.cableId && payload.cableInfo[ud.cableId]) || [];
    infoIsCable = Boolean(ud.cableId && !ud.nodeId);
    const title = ud.label || '';
    info.replaceChildren();
    const h = document.createElement('div');
    h.className = 'v3d-info-title';
    h.textContent = title;
    info.appendChild(h);
    rows.forEach(([k, v]) => {
      const r = document.createElement('div');
      r.className = 'v3d-info-row';
      const kk = document.createElement('span');
      kk.textContent = k;
      const vv = document.createElement('b');
      vv.textContent = v;
      r.append(kk, vv);
      info.appendChild(r);
    });
    info.style.display = 'block';
  });

  // ---- Mất / khôi phục WebGL context ----
  const lostBox = $('v3d-ctxlost');
  $('v3d-reload').addEventListener('click', () => location.reload());
  renderer.domElement.addEventListener(
    'webglcontextlost',
    e => {
      e.preventDefault(); // cho phép trình duyệt khôi phục
      ctxLost = true;
      loop.stop();
      controls.enabled = false;
      autoRotate = false;
      animFrom = null;
      animTo = null;
      tip.style.display = 'none';
      info.style.display = 'none';
      lostBox.style.display = 'flex';
    },
    false
  );
  renderer.domElement.addEventListener(
    'webglcontextrestored',
    () => {
      // Three.js tự khởi tạo lại trạng thái GL; texture PMREM là render target nên phải dựng lại,
      // và vòng lặp cũ đã dừng -> tạo vòng lặp mới (không giữ tài nguyên GPU/RAF cũ).
      try {
        buildEnvironment();
        loop = makeLoop();
        ctxLost = false;
        controls.enabled = true;
        $('v3d-auto').classList.remove('active');
        lostBox.style.display = 'none';
        request();
      } catch (err) {
        showFatal(`Không khôi phục được mô hình 3D sau khi mất kết nối đồ họa: ${err instanceof Error ? err.message : String(err)}. Hãy tải lại file.`);
      }
    },
    false
  );

  $('v3d-loading').style.display = 'none';
  request();
}

boot().catch(err => {
  console.error(err);
  showFatal(`Không thể dựng mô hình 3D: ${err instanceof Error ? err.message : String(err)}`);
});
