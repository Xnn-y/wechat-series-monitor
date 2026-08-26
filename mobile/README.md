# AutoJs6 手机端

- `src/` 是唯一应直接修改的模块化源码。
- `dist/wechat-series-monitor.js` 是由构建脚本生成、供 AutoJs6 直接运行的单文件入口，不要手工修改。

修改 `src/` 后，在仓库根目录执行：

```powershell
node tools\build_mobile_bundle.js
node --check mobile\dist\wechat-series-monitor.js
```

生成文件中的 `phase3` 内部变量名和设备数据目录为兼容现有部署而保留，不表示仓库仍按开发阶段组织。
