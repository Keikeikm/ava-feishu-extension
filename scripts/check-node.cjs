const [major, minor] = process.versions.node.split(".").map(Number);

if (major !== 22 || minor < 13) {
  console.error(
    `当前 Node.js ${process.version} 不受支持。本项目需要 Node.js 22.13.0 或以上的 22.x 版本。\n` +
      "请在仓库根目录执行 nvm use 22，然后重新运行原命令。",
  );
  process.exitCode = 1;
}
