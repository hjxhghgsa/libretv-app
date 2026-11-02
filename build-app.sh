#!/usr/bin/env bash
# 构建 LibreTV 桌面应用（Electron + Next standalone）
#
# 流程：
#   1. Next standalone 构建 → <LibreTV源码目录>/.next/standalone
#   2. 拷 static / public（Next 的 standalone 约定：这两块不自动包含）
#   3. 准备 resources/server + 图标
#   4. electron-builder 打包成 7z
#
# 用法：bash build-app.sh
set -euo pipefail

LIBRETV_DIR="${LIBRETV_DIR:-../LibreTV}"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
STANDALONE="$LIBRETV_DIR/.next/standalone"

echo "==> 1/6 Next standalone 构建"
cd "$LIBRETV_DIR"
if [ "${SKIP_NEXT_BUILD:-0}" = "1" ]; then
  echo "    (跳过，已手工构建)"
else
  DOCKER_BUILD=1 NEXT_TELEMETRY_DISABLED=1 PASSWORD="${PASSWORD:-change-me}" npx next build
fi

echo "==> 2/6 拷贝静态资源"
# Next standalone 不含 static/ 与 public/，必须手动拷。
# ★ 用覆盖式（cp -rf）而不是先删再拷：批量删除会被安全策略拦下
#   （一次删 >50 个文件触发确认），而且删了还得重拷，白费时间。
#   陈旧的 chunk 文件残留无害 —— chunk 名带 hash，HTML 只引用新 build 的那些。
mkdir -p "$STANDALONE/.next/static"
cp -rf "$LIBRETV_DIR/.next/static/." "$STANDALONE/.next/static/"
mkdir -p "$STANDALONE/public"
cp -rf "$LIBRETV_DIR/public/." "$STANDALONE/public/"
# .env.local 里的 PASSWORD 等运行时配置也要带过去
cp "$LIBRETV_DIR/.env.local" "$STANDALONE/.env.local" 2>/dev/null || true
echo "    static: $(du -sh "$STANDALONE/.next/static" | cut -f1)"
echo "    public: $(du -sh "$STANDALONE/public" | cut -f1)"

echo "==> 3/6 准备应用资源"
cd "$APP_DIR"
# 图标：复用 LibreTV 的 favicon（多尺寸 ico，含 16~256）
cp "$LIBRETV_DIR/public/favicon.ico" ./icon.ico
mkdir -p resources/server
cp -rf "$STANDALONE/." resources/server/
echo "    server: $(du -sh resources/server | cut -f1)"

echo "==> 4/6 清理旧的打包产物"
# ★ 必须清：electron-builder 在 app.asar 内容变化时可能复用旧缓存，
#   导致刚改的 main.js / preload.js 没进包（踩过一次：改完标题栏代码，
#   打包出来的 asar 里还是旧的，表现为「改了没效果」）。
rm -rf dist/win-unpacked 2>/dev/null || true
rm -f dist/*.7z dist/*.zip dist/*.exe 2>/dev/null || true

echo "==> 5/6 electron-builder 打包"
# electron / nsis 二进制下载走国内镜像（GitHub Releases 直连会失败）
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npx electron-builder --win --x64 --publish never

echo "==> 6/6 设置 exe 图标"
# ★ electron-builder 在这台机器上不会执行 rcedit 的 --set-icon
#   （它的图标转换走 app-builder 二进制，会因 winCodeSign 缓存问题跳过），
#   结果 exe 仍是 Electron 默认图标 —— 用户看到的就是「图标根本没改」。
#   这里手动补一步：直接调缓存里的 rcedit.exe 给 exe 写图标资源。
RCEDIT=""
for c in "$LOCALAPPDATA/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0/rcedit-x64.exe" \
         "$LOCALAPPDATA/electron-builder/Cache/winCodeSign"/*/rcedit-x64.exe; do
  [ -f "$c" ] && RCEDIT="$c" && break
done
if [ -n "$RCEDIT" ]; then
  "$RCEDIT" "$APP_DIR/dist/win-unpacked/LibreTV.exe" --set-icon "$APP_DIR/icon.ico" && echo "    ✓ exe 图标已设置"
else
  echo "    ⚠ 找不到 rcedit，exe 图标可能仍是默认的"
fi

echo
echo "==> 校验：确认 main.js 的改动确实进了 asar"
node -e "
const fs = require('fs');
const t = fs.readFileSync('dist/win-unpacked/resources/app.asar').toString('utf8');
const must = ['titleBarStyle', 'window:action', '0b101a'];
const missing = must.filter(k => !t.includes(k));
if (missing.length) {
  console.error('  ✗ asar 缺少: ' + missing.join(', '));
  process.exit(1);
}
console.log('  ✓ main.js 关键改动均已打包');
"

echo
echo "==> 完成，产物："
ls -la "$APP_DIR/dist"/*.7z 2>/dev/null || ls -la "$APP_DIR/dist" | grep -E "\.(exe|zip|7z)$" || true