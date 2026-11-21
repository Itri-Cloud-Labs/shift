// Electron main script: renders SVG files to PNG at given sizes through Chromium's canvas.
// Usage: electron raster.cjs JOBS.json   where JOBS is [{ svg, png, size }]
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { dirname } = require('node:path');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const jobs = JSON.parse(readFileSync(process.argv[process.argv.length - 1], 'utf8'));
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  for (const job of jobs) {
    const svg = readFileSync(job.svg, 'utf8');
    const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    const png = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = ${job.size}; canvas.height = ${job.size};
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, ${job.size}, ${job.size});
        resolve(canvas.toDataURL('image/png').split(',')[1]);
      };
      image.onerror = () => reject(new Error('cannot load ${job.svg}'));
      image.src = ${JSON.stringify(dataUrl)};
    })`);
    mkdirSync(dirname(job.png), { recursive: true });
    writeFileSync(job.png, Buffer.from(png, 'base64'));
  }
  console.log(`rendered ${jobs.length}`);
  app.quit();
});
