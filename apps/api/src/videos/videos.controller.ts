import {
  BadRequestException, Body, Controller, Get, NotFoundException,
  Param, Post, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import { DEFAULT_LANGUAGE, FORMATS, LANGUAGES } from '@cutroom/cutplan';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CutProcessor } from './cut.processor';
import { JobsStore } from '../store/jobs.store';

@Controller('api')
export class VideosController {
  constructor(
    private readonly cloud: CloudinaryService,
    private readonly cut: CutProcessor,
    private readonly jobs: JobsStore,
  ) {}

  @Get('formats')
  formats() {
    return FORMATS;
  }

  @Get('languages')
  languages() {
    return LANGUAGES.map(({ code, label, native }) => ({ code, label, native }));
  }

  @Get('videos')
  recent() {
    return this.jobs.recent();
  }

  @Post('videos')
  @UseInterceptors(FileInterceptor('video', { limits: { fileSize: 500 * 1024 * 1024 } }))
  async create(
    @UploadedFile() file: Express.Multer.File,
    @Body('clips') clips?: string,
    @Body('language') language = DEFAULT_LANGUAGE,
  ) {
    if (!file) throw new BadRequestException('Attach a video as the `video` field.');
    if (!LANGUAGES.some((l) => l.code === language)) {
      throw new BadRequestException(`Unsupported language: ${language}`);
    }

    const targetCount = Math.min(12, Math.max(1, Number(clips) || 6));
    const job = await this.jobs.create(file.originalname);

    try {
      await this.jobs.patch(job.id, { stage: 'uploading', progress: 5 });
      const md5 = createHash('md5').update(file.buffer).digest('hex');
      const existing = await this.cloud.findExisting(md5, file.size, language);
      const asset = existing ?? (await this.cloud.upload(file.buffer, file.originalname, md5, language));
      await this.jobs.patch(job.id, { progress: 12 }, { asset, reused: !!existing });
      await this.cut.enqueue({ jobId: job.id, asset, targetCount });
    } catch (e: any) {
      await this.jobs.patch(job.id, { stage: 'failed', error: e.message });
      throw new BadRequestException(e.message);
    }

    return { jobId: job.id };
  }

  @Get('videos/:id')
  async status(@Param('id') id: string) {
    const job = await this.jobs.get(id);
    if (!job) throw new NotFoundException('No such video.');
    return job;
  }
}
