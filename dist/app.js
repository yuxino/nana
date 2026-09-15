"use strict";
const $ = (id) => document.getElementById(id),
  wall = $("wall"),
  N = 24;
const builtWall = wall.src,
  builtTarget = "assets/avatar.jpg",
  wallLink =
    "https://pbs.twimg.com/media/HSQyiclaIAAHOhw?format=jpg&name=4096x4096";
let tiles = [],
  selection = null,
  version = 0,
  slot = "target",
  targetImage = null,
  grid = null,
  wallBusy = false;
const canvas = document.createElement("canvas");
canvas.width = canvas.height = N;
const ctx = canvas.getContext("2d", { willReadFrequently: true });
function feature(
  img,
  x = 0,
  y = 0,
  w = img.naturalWidth,
  h = img.naturalHeight,
) {
  ctx.clearRect(0, 0, N, N);
  ctx.drawImage(
    img,
    x + w * 0.09,
    y + h * 0.09,
    w * 0.82,
    h * 0.82,
    0,
    0,
    N,
    N,
  );
  return new Uint8ClampedArray(ctx.getImageData(0, 0, N, N).data);
}
function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4)
    for (let c = 0; c < 3; c++) sum += (a[i + c] - b[i + c]) ** 2;
  return sum / (N * N * 3);
}
function thumbnail(r) {
  const c = document.createElement("canvas");
  c.width = c.height = 108;
  const context = c.getContext("2d");
  // The wall background is visible around each rounded avatar. Clip it out
  // of the preview without changing the matching crop or source image.
  const inset = Math.min(r.w, r.h) * 0.025;
  context.beginPath();
  context.arc(54, 54, 54, 0, Math.PI * 2);
  context.clip();
  context.drawImage(
    wall,
    r.x + inset,
    r.y + inset,
    r.w - inset * 2,
    r.h - inset * 2,
    0,
    0,
    108,
    108,
  );
  return c.toDataURL("image/png");
}
function clearResult() {
  selection = null;
  $("candidates").replaceChildren();
  $("marker").classList.add("hidden");
  $("locatorTip").classList.add("hidden");
  $("location").textContent = "完整图片";
  $("count").textContent = "等待匹配";
}
function locationLabel(r) {
  return r.row !== undefined
    ? `第 ${r.row} 排，第 ${r.col} 列`
    : "相似位置（未识别到规则网格）";
}
function updateTip() {
  const tip = $("locatorTip");
  if (!selection || $("marker").classList.contains("hidden")) {
    tip.classList.add("hidden");
    return;
  }
  const v = $("viewport").getBoundingClientRect(),
    m = $("marker").getBoundingClientRect(),
    panel = document.querySelector(".wall-panel").getBoundingClientRect();
  const pad = 9;
  if (
    m.right <= v.left ||
    m.left >= v.right ||
    m.bottom <= v.top ||
    m.top >= v.bottom
  ) {
    tip.classList.add("hidden");
    return;
  }
  tip.classList.remove("hidden");
  tip.style.maxWidth = Math.max(0, v.width - pad * 2) + "px";
  const w = tip.offsetWidth,
    h = tip.offsetHeight;
  const x = Math.max(
    v.left + pad,
    Math.min(v.right - pad - w, (m.left + m.right - w) / 2),
  );
  let y = m.top - h - 12;
  if (y < v.top + pad) y = m.bottom + 12;
  y = Math.max(v.top + pad, Math.min(v.bottom - pad - h, y));
  tip.style.left = x - panel.left + "px";
  tip.style.top = y - panel.top + "px";
}
function place(r, k) {
  selection = r;
  const m = $("marker"),
    x = Math.max(0, r.x),
    y = Math.max(0, r.y),
    w = Math.min(r.w, wall.naturalWidth - x),
    h = Math.min(r.h, wall.naturalHeight - y);
  m.classList.remove("hidden");
  Object.assign(m.style, {
    left: (x / wall.naturalWidth) * 100 + "%",
    top: (y / wall.naturalHeight) * 100 + "%",
    width: (w / wall.naturalWidth) * 100 + "%",
    height: (h / wall.naturalHeight) * 100 + "%",
  });
  $("locatorTip").textContent = locationLabel(r);
  $("location").textContent = locationLabel(r);
  document.querySelectorAll(".candidate").forEach((b, i) => {
    b.classList.toggle("active", i === k);
    b.setAttribute("aria-pressed", String(i === k));
  });
  requestAnimationFrame(() => {
    const v = $("viewport"),
      scale = $("stage").clientWidth / wall.naturalWidth;
    v.scrollTo({
      left: (x + w / 2) * scale - v.clientWidth / 2,
      top: (y + h / 2) * scale - v.clientHeight / 2,
    });
    updateTip();
  });
}
$("viewport").addEventListener("scroll", updateTip, { passive: true });
window.addEventListener("resize", updateTip);
new ResizeObserver(updateTip).observe($("stage"));

const yieldFrame = () => new Promise((resolve) => setTimeout(resolve, 0));
// Search arbitrary images at multiple sizes, then refine the strongest candidates.
async function generalSearch(img, ticket) {
  const c = document.createElement("canvas"),
    scale = Math.min(1, 900 / Math.max(wall.naturalWidth, wall.naturalHeight));
  c.width = Math.round(wall.naturalWidth * scale);
  c.height = Math.round(wall.naturalHeight * scale);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(wall, 0, 0, c.width, c.height);
  const pixels = g.getImageData(0, 0, c.width, c.height).data;
  const q = document.createElement("canvas");
  q.width = q.height = 8;
  const qg = q.getContext("2d");
  qg.drawImage(img, 0, 0, 8, 8);
  const target = qg.getImageData(0, 0, 8, 8).data,
    ratio = img.naturalWidth / img.naturalHeight;
  let best = [];
  function score(x, y, w, h) {
    let sum = 0;
    for (let j = 1; j < 7; j++)
      for (let i = 1; i < 7; i++) {
        const a = (j * 8 + i) * 4,
          b =
            (Math.min(c.height - 1, Math.floor(y + ((j + 0.5) / 8) * h)) *
              c.width +
              Math.min(c.width - 1, Math.floor(x + ((i + 0.5) / 8) * w))) *
            4;
        for (let k = 0; k < 3; k++) sum += (target[a + k] - pixels[b + k]) ** 2;
      }
    return sum / 108;
  }
  const maxH = Math.min(c.height, c.width / ratio);
  for (let h = Math.max(10, maxH * 0.018); h <= maxH; h *= 1.16) {
    const w = h * ratio,
      step = Math.max(2, Math.round(Math.min(w, h) / 5));
    for (let y = 0; y <= c.height - h; y += step)
      for (let x = 0; x <= c.width - w; x += step)
        best.push({ x, y, w, h, score: score(x, y, w, h) });
    best.sort((a, b) => a.score - b.score);
    best = best.slice(0, 70);
    await yieldFrame();
    if (ticket !== version) return [];
  }
  const refined = [];
  for (const b of best) {
    let win = b;
    for (const size of [0.92, 0.96, 1, 1.04, 1.08]) {
      const h = b.h * size,
        w = b.w * size,
        step = Math.max(1, Math.round(Math.min(w, h) / 28)),
        radius = Math.max(2, Math.round(Math.min(w, h) / 5));
      for (let dy = -radius; dy <= radius; dy += step)
        for (let dx = -radius; dx <= radius; dx += step) {
          const x = b.x + dx,
            y = b.y + dy;
          if (x < 0 || y < 0 || x + w > c.width || y + h > c.height) continue;
          const value = score(x, y, w, h);
          if (value < win.score) win = { x, y, w, h, score: value };
        }
    }
    refined.push(win);
    if (refined.length % 10 === 0) {
      await yieldFrame();
      if (ticket !== version) return [];
    }
  }
  refined.sort((a, b) => a.score - b.score);
  const unique = [];
  for (const r of refined) {
    if (
      unique.some(
        (b) =>
          Math.abs(b.x + b.w / 2 - r.x - r.w / 2) < Math.min(b.w, r.w) * 0.65 &&
          Math.abs(b.y + b.h / 2 - r.y - r.h / 2) < Math.min(b.h, r.h) * 0.65,
      )
    )
      continue;
    unique.push(r);
    if (unique.length === 6) break;
  }
  return unique.map((r) => ({
    ...r,
    x: r.x / scale,
    y: r.y / scale,
    w: r.w / scale,
    h: r.h / scale,
  }));
}
async function search() {
  if (!targetImage || wallBusy) return;
  const ticket = ++version;
  clearResult();
  $("status").textContent = "正在查找相似位置…";
  $("count").textContent = "匹配中";
  await yieldFrame();
  let ranks;
  if (grid) {
    const size = Math.min(targetImage.naturalWidth, targetImage.naturalHeight),
      data = feature(
        targetImage,
        (targetImage.naturalWidth - size) / 2,
        (targetImage.naturalHeight - size) / 2,
        size,
        size,
      );
    ranks = tiles
      .map((t) => ({ ...t.r, score: distance(data, t.data) }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 6);
  } else ranks = await generalSearch(targetImage, ticket);
  if (ticket !== version) return;
  ranks.forEach((r, k) => {
    const b = document.createElement("button");
    b.className = "candidate";
    b.dataset.index = r.index ?? k;
    b.setAttribute("aria-label", `候选 ${k + 1}，${locationLabel(r)}`);
    const im = new Image();
    im.src = thumbnail(r);
    im.alt = `候选 ${k + 1}`;
    const text = document.createElement("span");
    text.textContent =
      r.row !== undefined ? `${r.row} 排 ${r.col} 列` : `候选 ${k + 1}`;
    b.append(im, text);
    b.onclick = () => {
      place(r, k);
      if (innerWidth < 761)
        $("location").scrollIntoView({ block: "start", behavior: "smooth" });
    };
    $("candidates").append(b);
  });
  $("count").textContent = `${ranks.length} 个候选`;
  $("status").textContent = !ranks.length
    ? "未找到相似位置"
    : !grid
      ? "未识别到规则网格，仅显示相似位置。"
      : ranks[0].score < 650
        ? "已定位"
        : "相似候选，请核对头像。";
  if (ranks.length) place(ranks[0], 0);
}
async function decode(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}
// Infer regular tile spacing from low-texture gutters; no image-specific dimensions.
function detectGrid(img) {
  const c = document.createElement("canvas"),
    scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, c.width, c.height);
  const W = c.width,
    H = c.height,
    d = g.getImageData(0, 0, W, H).data,
    X = new Float64Array(W),
    Y = new Float64Array(H);
  for (let y = 1; y < H; y++)
    for (let x = 1; x < W; x++) {
      const i = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) {
        X[x] += Math.abs(d[i + k] - d[i - W * 4 + k]);
        Y[y] += Math.abs(d[i + k] - d[i - 4 + k]);
      }
    }
  for (let x = 0; x < W; x++) X[x] /= H * 3;
  for (let y = 0; y < H; y++) Y[y] /= W * 3;
  function axis(a) {
    const med = [...a].sort((x, y) => x - y)[a.length >> 1];
    if (med < 1.5) return null;
    let best = null;
    for (const threshold of [0.35, 0.5, 0.65]) {
      const runs = [];
      let start = -1;
      for (let i = 0; i <= a.length; i++) {
        if (i < a.length && a[i] < med * threshold) {
          if (start < 0) start = i;
        } else if (start >= 0) {
          if (i - start <= Math.max(4, a.length * 0.007))
            runs.push((start + i - 1) / 2);
          start = -1;
        }
      }
      if (runs.length < 3) continue;
      const hist = new Map();
      for (let i = 1; i < runs.length; i++) {
        const gap = Math.round(runs[i] - runs[i - 1]);
        if (gap >= 8 && gap < a.length / 3)
          hist.set(gap, (hist.get(gap) || 0) + 1);
      }
      const modes = [...hist].sort((a, b) => b[1] - a[1]).slice(0, 4);
      for (const [seed] of modes) {
        let points = runs
          .map((p) => ({ p, k: Math.round((p - runs[0]) / seed) }))
          .filter(
            (t) =>
              Math.abs(t.p - runs[0] - t.k * seed) < Math.max(2, seed * 0.12),
          );
        if (points.length < 3) continue;
        const regress = () => {
          let n = points.length,
            sx = 0,
            sy = 0,
            sxx = 0,
            sxy = 0;
          for (const t of points) {
            sx += t.k;
            sy += t.p;
            sxx += t.k * t.k;
            sxy += t.k * t.p;
          }
          const step = (n * sxy - sx * sy) / (n * sxx - sx * sx);
          return { step, base: (sy - step * sx) / n };
        };
        let fit = regress();
        if (!Number.isFinite(fit.step)) continue;
        points = runs
          .map((p) => ({ p, k: Math.round((p - fit.base) / fit.step) }))
          .filter(
            (t) =>
              Math.abs(t.p - fit.base - t.k * fit.step) <
              Math.max(1.6, fit.step * 0.05),
          );
        if (points.length < 3) continue;
        fit = regress();
        const first = Math.min(...points.map((t) => t.k)),
          last = Math.max(...points.map((t) => t.k)),
          coverage = points.length / (last - first + 1),
          error =
            points.reduce(
              (v, t) => v + Math.abs(t.p - fit.base - t.k * fit.step),
              0,
            ) / points.length;
        if (coverage < 0.55 || error > Math.max(1.5, fit.step * 0.04)) continue;
        let origin = fit.base + first * fit.step;
        function textured(start) {
          const left = Math.max(0, Math.ceil(start + fit.step * 0.08)),
            right = Math.min(a.length, Math.floor(start + fit.step * 0.92));
          let sum = 0;
          for (let i = left; i < right; i++) sum += a[i];
          return right > left && sum / (right - left) > med * 0.38;
        }
        while (origin - fit.step >= -1 && textured(origin - fit.step))
          origin -= fit.step;
        const quality = (points.length * coverage) / (1 + error);
        if (!best || quality > best.quality)
          best = {
            origin: Math.max(0, origin),
            step: fit.step,
            quality,
            med,
            textured,
          };
      }
    }
    return best;
  }
  const ax = axis(X),
    ay = axis(Y);
  if (
    !ax ||
    !ay ||
    Math.abs(ax.step - ay.step) / Math.max(ax.step, ay.step) > 0.15
  )
    return null;
  let cols = 0;
  while (
    ax.origin + (cols + 1) * ax.step <= W + 1 &&
    ax.textured(ax.origin + cols * ax.step)
  )
    cols++;
  if (cols < 3) return null;
  function activity(x, y, w, h) {
    const pixel = (x, y, k) =>
      d[
        (Math.max(0, Math.min(H - 1, Math.round(y))) * W +
          Math.max(0, Math.min(W - 1, Math.round(x)))) *
          4 +
          k
      ];
    const samples = [],
      mean = [0, 0, 0];
    for (let j = 1; j <= 6; j++)
      for (let i = 1; i <= 6; i++) {
        const rgb = [0, 1, 2].map((k) =>
          pixel(x + (w * i) / 7, y + (h * j) / 7, k),
        );
        samples.push(rgb);
        for (let k = 0; k < 3; k++) mean[k] += rgb[k] / 36;
      }
    let variation = 0;
    for (const rgb of samples)
      for (let k = 0; k < 3; k++) variation += Math.abs(rgb[k] - mean[k]) / 108;
    let sideDifference = Infinity;
    for (const px of [x, x + w]) {
      let difference = 0;
      for (let k = 0; k < 3; k++)
        difference += Math.abs(mean[k] - pixel(px, y + h * 0.5, k)) / 3;
      sideDifference = Math.min(sideDifference, difference);
    }
    return Math.max(variation, sideDifference * 0.6);
  }
  const cells = [];
  let rows = 0;
  for (let row = 0; ay.origin + (row + 1) * ay.step <= H + 1; row++) {
    const y = ay.origin + row * ay.step;
    let last = -1;
    for (let col = 0; col < cols; col++) {
      const x = ax.origin + col * ax.step;
      if (activity(x, y, ax.step, ay.step) > 5) last = col;
    }
    if (last < 0) break;
    for (let col = 0; col <= last; col++) {
      const inset = Math.max(0.7, Math.min(ax.step, ay.step) * 0.015),
        x = ax.origin + col * ax.step;
      cells.push({
        x: (x + inset) / scale,
        y: (y + inset) / scale,
        w: (ax.step - inset * 2) / scale,
        h: (ay.step - inset * 2) / scale,
        row: row + 1,
        col: col + 1,
        index: row * cols + col,
      });
    }
    rows++;
  }
  if (rows < 3 || cells.length < 9) return null;
  return { cols, rows, cells };
}

function indexWall() {
  grid = detectGrid(wall);
  tiles = grid
    ? grid.cells.map((r) => ({ r, data: feature(wall, r.x, r.y, r.w, r.h) }))
    : [];
  $("gridInfo").textContent = grid
    ? `${grid.rows} 排 · ${grid.cols} 列`
    : "未识别到规则网格";
}
const ready = (async () => {
  await wall.decode();
  indexWall();
})();
ready.catch(() => {
  $("status").textContent = "默认大图加载失败，请刷新页面。";
});
function chooseSlot(value) {
  slot = value;
}
let revisions = { wall: 0, target: 0 };
async function loadSource(src, type, name) {
  const rev = ++revisions[type];
  ++version;
  clearResult();
  if (type === "wall") wallBusy = true;
  $("status").textContent = "正在读取图片…";
  try {
    await ready;
    const img = await decode(src);
    if (
      img.naturalWidth < 8 ||
      img.naturalHeight < 8 ||
      img.naturalWidth * img.naturalHeight > 50000000
    )
      throw new Error("image dimensions");
    if (rev !== revisions[type]) return;
    if (type === "wall") {
      wall.src = src;
      await wall.decode();
      if (rev !== revisions.wall) return;
      indexWall();
      $("wallName").textContent =
        `${name || "已更新大图"} · ${wall.naturalWidth} × ${wall.naturalHeight}`;
      wallBusy = false;
      chooseSlot("target");
    } else {
      targetImage = img;
      $("preview").src = src;
      $("preview").classList.remove("hidden");
      $("targetName").textContent = name || "要查找的头像";
    }
    await search();
    if (!targetImage)
      $("status").textContent = "大图已就绪，请输入要找的用户名或图片地址。";
  } catch (e) {
    if (rev === revisions[type]) {
      if (type === "wall") wallBusy = false;
      $("status").textContent = "无法读取图片，请使用 PNG、JPG 或 WebP 图片。";
      $("count").textContent = "读取失败";
    }
  }
}
async function loadFile(file, type) {
  if (!file) return;
  ++urlTickets[type];
  if (!file.type.startsWith("image/")) {
    $("status").textContent = "请选择图片文件。";
    return;
  }
  if (file.size > 40 * 1024 * 1024) {
    $("status").textContent = "请选择小于 40 MB 的图片。";
    return;
  }
  const src = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  await loadSource(src, type, file.name);
}
function parseHandle(raw) {
  const value = raw.trim();
  if (/^@?[A-Za-z0-9_]{1,15}$/.test(value)) return value.replace(/^@/, "");
  try {
    const url = new URL(
      /^https?:\/\//i.test(value) ? value : "https://" + value,
    );
    if (
      ![
        "x.com",
        "www.x.com",
        "mobile.x.com",
        "twitter.com",
        "www.twitter.com",
        "mobile.twitter.com",
      ].includes(url.hostname)
    )
      return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length > 2 || (parts.length === 2 && parts[1] !== "photo"))
      return null;
    const handle = parts[0];
    if (
      !/^[A-Za-z0-9_]{1,15}$/.test(handle) ||
      [
        "home",
        "explore",
        "search",
        "settings",
        "notifications",
        "messages",
        "i",
        "intent",
        "compose",
      ].includes(handle.toLowerCase())
    )
      return null;
    return handle;
  } catch {
    return null;
  }
}
let urlTickets = { wall: 0, target: 0 };
async function loadUrl(type, raw) {
  const value = (raw || $(type + "Url").value).trim(),
    ticket = ++urlTickets[type];
  ++version;
  ++revisions[type];
  if (type === "wall") wallBusy = false;
  clearResult();
  const handle = type === "target" ? parseHandle(value) : null;
  try {
    let imageUrl = value;
    if (handle) {
      $("status").textContent = `正在读取 ${handle} 的头像…`;
      $("count").textContent = "读取中";
      const response = await fetch(
        "https://api.fxtwitter.com/" + encodeURIComponent(handle),
        { signal: AbortSignal.timeout(15000), credentials: "omit" },
      );
      if (ticket !== urlTickets[type]) return;
      const data = await response.json();
      if (!response.ok || data.code !== 200 || !data.user?.avatar_url)
        throw new Error(
          data.code === 404 || response.status === 404
            ? "找不到这个账号，请检查用户名。"
            : "暂时无法读取这个账号，请稍后重试或粘贴头像图片地址。",
        );
      const avatar = new URL(data.user.avatar_url);
      if (avatar.protocol !== "https:" || avatar.hostname !== "pbs.twimg.com")
        throw new Error("头像地址不可用，请粘贴头像图片地址。");
      imageUrl = avatar.href.replace(
        /_normal(\.[a-z0-9]+)(\?.*)?$/i,
        "_400x400$1$2",
      );
    } else {
      let url;
      try {
        url = new URL(value);
      } catch {
        throw new Error("请输入用户名、X 主页链接或图片地址。");
      }
      if (!["https:", "http:"].includes(url.protocol))
        throw new Error("请输入有效的图片链接。");
      if (
        [
          "x.com",
          "www.x.com",
          "twitter.com",
          "www.twitter.com",
          "mobile.x.com",
          "mobile.twitter.com",
        ].includes(url.hostname)
      )
        throw new Error("请输入用户名或主页链接，例如 vvnuds。");
      if (value === wallLink) {
        await loadSource(builtWall, type, "你提供的头像墙");
        return;
      }
      $("status").textContent = "正在读取图片链接…";
    }
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000),
      credentials: "omit",
    });
    if (!response.ok)
      throw new Error("图片读取失败，请稍后重试或换一个图片地址。");
    const blob = await response.blob();
    if (ticket !== urlTickets[type]) return;
    if (!blob.type.startsWith("image/"))
      throw new Error("这个链接不是图片，请复制图片地址。");
    await loadFile(
      new File([blob], handle ? handle + " 当前头像" : "链接图片", {
        type: blob.type,
      }),
      type,
    );
    if (handle && ticket + 1 === urlTickets[type])
      $("avatarSource").textContent = `${handle} · FxTwitter`;
  } catch (e) {
    if (ticket !== urlTickets[type]) return;
    $("count").textContent = "读取失败";
    $("status").textContent =
      e.name === "TimeoutError"
        ? "读取超时，请稍后重试或粘贴头像图片地址。"
        : e.message === "Failed to fetch"
          ? "网络或图片跨站读取受限，请稍后重试或粘贴头像图片地址。"
          : e.message;
  }
}

for (const type of ["wall", "target"]) {
  $(type + "UrlLoad").onclick = () => loadUrl(type);
  $(type + "Url").onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      loadUrl(type);
    }
  };
}
window.addEventListener("paste", (e) => {
  if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
  const text = e.clipboardData?.getData("text/plain")?.trim();
  if (
    text &&
    (/^https?:\/\//.test(text) || (slot === "target" && parseHandle(text)))
  ) {
    e.preventDefault();
    $(slot + "Url").value = text;
    if (slot === "wall") fitWallAddress();
    loadUrl(slot, text);
  }
});
$("zoom").oninput = () => {
  $("stage").style.width = $("zoom").value + "%";
  if (selection)
    place(
      selection,
      [...document.querySelectorAll(".candidate")].findIndex((b) =>
        b.classList.contains("active"),
      ),
    );
};
$("fit").onclick = () => {
  $("zoom").value = 100;
  $("stage").style.width = "100%";
  $("marker").classList.add("hidden");
  $("locatorTip").classList.add("hidden");
  $("location").textContent = "完整图片";
  selection = null;
  document.querySelectorAll(".candidate").forEach((b) => {
    b.classList.remove("active");
    b.setAttribute("aria-pressed", "false");
  });
  $("viewport").scrollTo({ top: 0, left: 0 });
};
$("demo").onclick = async () => {
  await loadSource(builtWall, "wall", "你提供的头像墙");
  await loadSource(builtTarget, "target", "vvnuds");
};

$("wallUrl").value = wallLink;
$("targetUrl").value = "vvnuds";
for (const type of ["wall", "target"])
  $(type + "Slot").addEventListener("focusin", () => chooseSlot(type));
ready.then(() => loadSource(builtTarget, "target", "vvnuds")).catch(() => {});

function fitWallAddress() {
  const field = $("wallUrl");
  field.style.height = "auto";
  field.style.height = Math.max(88, field.scrollHeight + 2) + "px";
}
$("wallUrl").addEventListener("input", fitWallAddress);
$("wallSlot").addEventListener("toggle", fitWallAddress);
window.addEventListener("resize", fitWallAddress);
requestAnimationFrame(fitWallAddress);
