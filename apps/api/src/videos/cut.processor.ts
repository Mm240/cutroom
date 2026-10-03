import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { plan } from '@cutroom/cutplan';
import { CloudinaryService, type VideoAsset } from '../cloudinary/cloudinary.service';
import { JobsStore } from '../store/jobs.store';

const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };

export interface CutJob {
  jobId: string;
  asset: VideoAsset;
  targetCount: number;
}

@Injectable()
export class CutProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CutProcessor.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly cloud: CloudinaryService,
    private readonly jobs: JobsStore,
  ) {}

  onModuleInit() {
    this.queue = new Queue('cut', { connection });
    this.worker = new Worker<CutJob>('cut', (j) => this.process(j.data), {
      connection,
      concurrency: 2,
    });
    this.worker.on('failed', (j, e) => this.log.error(`${j?.id}: ${e.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  enqueue(job: CutJob) {
    if (!this.queue) throw new Error('Queue not ready');
    return this.queue.add('cut', job, { removeOnComplete: 50, attempts: 1 });
  }

  /** Public so tests can drive a run with fakes and no Redis. */
  async process({ jobId, asset, targetCount }: CutJob) {
    try {
      // Transcription dominates the wall clock, so it gets its own stage and
      // an honest progress band rather than being hidden inside "processing".
      await this.jobs.patch(jobId, { stage: 'transcribing', progress: 15 },
        { preview: this.cloud.previewUrl(asset), duration: asset.duration });

      // Chunks are transcribed in parallel; each one landing moves the bar
      // through the listening band and tells the console how far along it is.
      const cues = await this.cloud.transcribe(asset, (done, total) =>
        this.jobs.patch(jobId, { progress: Math.round(15 + (30 * done) / total) }, { heard: { done, total } })
          .then(() => undefined),
      );
      if (!cues.length) {
        await this.jobs.patch(jobId, { stage: 'failed', error: 'No speech was found in this video.' });
        return;
      }
      await this.jobs.patch(jobId, { progress: 45 }, { cueCount: cues.length });

      await this.jobs.patch(jobId, { stage: 'planning', progress: 55 });
      const cutPlan = plan(cues, { targetCount });

      if (!cutPlan.segments.length) {
        await this.jobs.patch(jobId, {
          stage: 'failed',
          error: 'No stretch of this video scored well enough to cut. Try a longer source.',
        });
        return;
      }

      await this.jobs.patch(jobId, { progress: 70 }, { plan: cutPlan });

      // Renders are URLs. Cloudinary encodes each one on first request, so
      // nothing here blocks — the console starts showing posters immediately.
      await this.jobs.patch(jobId, { stage: 'rendering', progress: 85 });
      const renders = this.cloud.renderAll(asset, cutPlan.segments);
      const strips = Object.fromEntries(
        cutPlan.segments.map((s) => [s.id, this.cloud.filmstrip(asset, s)]),
      );

      await this.jobs.patch(jobId, { stage: 'ready', progress: 100 }, { renders, strips });

      // Encode in the background after the console already has its URLs, so
      // the clips are playable by the time anyone clicks one.
      this.cloud.warm(renders).catch(() => undefined);
    } catch (err: any) {
      this.log.error(err.stack ?? err.message);
      await this.jobs.patch(jobId, { stage: 'failed', error: err.message });
      throw err;
    }
  }
}
