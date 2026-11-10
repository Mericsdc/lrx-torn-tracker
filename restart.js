// Electron relaunch waits for the old process to exit; destroy every native
// window/view first so session renderers and disabled action state cannot survive.
function restartApplication({ app, windows, log = () => {} }) {
  app.relaunch();
  for (const win of windows) {
    if (win.isDestroyed()) continue;
    for (const view of win.contentView?.children || []) {
      try { if (view.webContents && !view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false }); } catch {}
    }
    win.destroy();
  }
  log('All windows closed; exiting old process for relaunch');
  app.exit(0);
}
module.exports = { restartApplication };
