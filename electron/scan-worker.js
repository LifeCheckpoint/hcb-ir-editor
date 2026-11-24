/**
 * 在 worker 里跑目录扫描：主进程只负责接收进度和最终结果。
 * 这样扫描大归档时窗口仍能响应。
 */
const { parentPort, workerData } = require('node:worker_threads');
const { scanDirectory } = require('./scan');

try {
  const result = scanDirectory(workerData.dir, (progress) => {
    parentPort.postMessage({ type: 'progress', progress });
  });
  parentPort.postMessage({ type: 'done', result });
} catch (err) {
  parentPort.postMessage({ type: 'error', error: String((err && err.message) || err) });
}
