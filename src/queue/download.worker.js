const { Worker } = require('bullmq');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { connection } = require('./download.queue');
const { createTempCookieFile } = require('../extractors/youtube');
require('dotenv').config();

// Ensure temp downloads directory exists
const DOWNLOADS_DIR = path.join(__dirname, '../../temp_downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Function to find yt-dlp binary
const getYtdlpPath = () => {
  const localBin = path.join(__dirname, '../../yt-dlp');
  return fs.existsSync(localBin) ? localBin : 'yt-dlp';
};

const worker = new Worker('downloads', async (job) => {
  const { url, filename, formatArg, igCookies, needsMerge } = job.data;
  const safeName = (filename || 'download').toString().replace(/[^a-zA-Z0-9._-]/g, '_');
  const finalExt = safeName.includes('.') ? '' : '.mp4'; // Fallback if no ext
  const finalFileName = `${job.id}_${safeName}${finalExt}`;
  const outputPath = path.join(DOWNLOADS_DIR, finalFileName);

  console.log(`[Worker] Starting job ${job.id}: ${url}`);

  await job.updateProgress(10); // 10% - starting

  return new Promise((resolve, reject) => {
    const ytdlpPath = getYtdlpPath();
    const args = [
      '-f', formatArg || 'best',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '-o', outputPath // Output directly to file instead of stdout
    ];

    if (needsMerge) {
      args.push('--merge-output-format', 'mp4');
    }

    const cookiesPath = path.join(__dirname, '../../cookies.txt');
    let tempIgCookieFile = null;
    if (igCookies) {
       tempIgCookieFile = createTempCookieFile(igCookies);
       args.push('--cookies', tempIgCookieFile);
    } else if (fs.existsSync(cookiesPath)) {
       args.push('--cookies', cookiesPath);
    } else {
       args.push('--cookies-from-browser', 'chrome');
    }

    args.push(url);

    const ytProcess = spawn(ytdlpPath, args, { windowsHide: true });

    const cleanupTempFile = () => { if (tempIgCookieFile) try { fs.unlinkSync(tempIgCookieFile); } catch (e) {} };

    // Simulate progress (since yt-dlp stdout parsing can be complex)
    let fakeProgress = 10;
    const interval = setInterval(async () => {
      fakeProgress += 5;
      if (fakeProgress < 90) {
        await job.updateProgress(fakeProgress);
      }
    }, 2000);

    ytProcess.stdout.on('data', (data) => {
      // Could parse yt-dlp percentage here if needed
      console.log(`[Job ${job.id}]:`, data.toString().trim());
    });

    ytProcess.stderr.on('data', (data) => {
      console.log(`[Job ${job.id} Error]:`, data.toString().trim());
    });

    ytProcess.on('error', (err) => {
      cleanupTempFile();
      clearInterval(interval);
      reject(err);
    });

    ytProcess.on('close', async (code) => {
      cleanupTempFile();
      clearInterval(interval);
      if (code === 0) {
        await job.updateProgress(100);
        resolve({
          success: true,
          filePath: outputPath,
          fileName: finalFileName,
          downloadUrl: `/api/media/serve/${finalFileName}` // Endpoint to fetch the file
        });
      } else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });
  });
}, {
  connection,
  concurrency: 3, // Process up to 3 downloads concurrently
});

worker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job.id} has failed with ${err.message}`);
});

console.log('[Worker] Download worker started.');
