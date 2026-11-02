# LibreTV 桌面版（libretv-app）

把 [LibreTV](https://github.com/hjxhghgsa/libretv-mod) 网页版打包成**桌面应用**（Electron + Next.js standalone），双击即用、自带后台服务、无需另装 Node 或浏览器。

> 本仓库是**桌面外壳与构建脚本**，不包含 LibreTV 网页版源码本身；构建时通过 `LIBRETV_DIR` 引用 LibreTV 源码目录。

---

## 一、项目要解决的问题

LibreTV 网页版需要手动起 Node 服务 + 开浏览器，对"只想双击看番"的场景不够友好。
本项目提供 Electron 外壳，把 Next.js standalone 服务内嵌进桌面程序：开机即窗口、后台服务自拉起、带桌面图标，体验接近原生应用。

## 二、主要功能

| 文件 | 作用 |
| --- | --- |
| `main.js` | Electron 主进程：拉起内嵌 standalone 服务、管理窗口、错误提示 |
| `preload.js` | 渲染进程预加载桥接 |
| `build-app.sh` | 一键构建：Next standalone → 打包 `resources/server` → electron-builder 出 `dist/*.7z` |
| `启动.bat` | Windows 启动器（清掉会让 Electron 退化成普通 Node 的环境变量） |
| `package.json` | 依赖与 electron-builder 配置 |
| `icon.ico` / `resources/启动.bat` | 应用图标与桌面启动入口 |

> 注意：`resources/server/` 是构建产物（含内嵌服务），已被 `.gitignore` 忽略，无需入库。

## 三、安装方法

### 前置

- [Node.js](https://nodejs.org/)（建议 18+）
- 已克隆 LibreTV 网页版源码（见上方链接）

### 构建

```bash
# 1. 克隆本项目
git clone https://github.com/hjxhghgsa/libretv-app.git
cd libretv-app

# 2. 安装依赖
npm install

# 3. 指定 LibreTV 网页版源码目录（默认 ../LibreTV，可用环境变量覆盖）
export LIBRETV_DIR=/path/to/LibreTV      # 改成你的实际路径
export PASSWORD=your-password             # 构建时注入的访问密码（不要用真实密码明文提交）

# 4. 一键构建（产物在 dist/，如 LibreTV-桌面版-*.7z）
bash build-app.sh
```

> `build-app.sh` 内部已配置国内镜像下载 electron / electron-builder 二进制。

## 四、使用示例

- **开发模式**：`main.js` 会通过 `LIBRETV_DIR` 环境变量（默认当前目录下的 `LibreTV`）连接本地 `next start`，便于改外壳代码时热调试。
- **打包后**：双击 `dist/win-unpacked/LibreTV.exe`（或安装构建出的安装包），应用自拉起内嵌服务并弹出窗口，直接搜番观看。
- **自定义图标**：替换根目录 `icon.ico` 后重新 `build-app.sh` 即可。

---

## 许可证

本桌面外壳以 [MIT 许可证](./LICENSE) 开源；内嵌的 LibreTV 服务本身沿用其上游 **AGPL-3.0** 许可证。
