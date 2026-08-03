const { Queue } = require('bullmq');
const Redis = require('ioredis');
require('dotenv').config();

// Standard Redis connection for BullMQ
const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

// Create the download queue
const downloadQueue = new Queue('downloads', { connection });

/**
 * Enqueue a new download job.
 * @param {Object} jobData - Data required for the download (url, options, igCookies, platform).
 */
const addDownloadJob = async (jobData) => {
  // Add job to queue
  const job = await downloadQueue.add('extract', jobData, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: true, // Auto-cleanup to save memory
    removeOnFail: false,    // Keep failures for debugging
  });
  return job;
};

module.exports = {
  downloadQueue,
  addDownloadJob,
  connection,
};
