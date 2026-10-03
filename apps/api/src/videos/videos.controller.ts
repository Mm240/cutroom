import {
  BadRequestException, Body, CanActivate, Controller, ExecutionContext, Get,
  Injectable, NotFoundException, Param, Post, UnauthorizedException,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DEFAULT_LANGUAGE, FORMATS, LANGUAGES } from '@cutroom/cutplan';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CutProcessor } from './cut.processor';
import { JobsStore } from '../store/jobs.store';

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 500);

/**
 * Uploads spend the owner's Cloudinary credits, so a public deployment can
 * require a passcode. It is checked in a guard, which runs before the upload
 * interceptor — a stranger's 500 MB file is refused before it is received.
 * With UPLOAD_PASSCODE unset (local development) everyone may upload.
 */
@Injectable()
class PasscodeGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const expected = process.env.UPLOAD_PASSCODE;
    if (!expected) return true;
    const given = String(ctx.switchToHttp().getRequest().headers['x-cutroom-passcode'] ?? '');
    const digest = (v: string) => createHash('sha256').update(v).digest();
    if (!timingSafeEqual(digest(given), digest(expected))) {
      throw new UnauthorizedException('Wrong passcode.');
    }
    return true;
  }
}

/** MD5 of a file on disk, streamed so a large upload never sits in memory. */
function md5File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    createReadStream(path)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

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

  /** What the console needs to know before it offers an upload. */
  @Get('config')
  config() {
    return { passcodeRequired: !!process.env.UPLOAD_PASSCODE, maxUploadMb: MAX_UPLOAD_MB };
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
  @UseGuards(PasscodeGuard)
  // Spooled to disk, not memory: a small instance has less RAM than the
  // largest video we accept.
  @UseInterceptors(FileInterceptor('video', { dest: tmpdir(), limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 } }))
  async create(
    @UploadedFile() file: Express.Multer.File,
    @Body('clips') clips?: string,
    @Body('language') language = DEFAULT_LANGUAGE,
  ) {
    if (!file) throw new BadRequestException('Attach a video as the `video` field.');
    if (!LANGUAGES.some((l) => l.code === language)) {
      unlink(file.path).catch(() => undefined);
      throw new BadRequestException(`Unsupported language: ${language}`);
    }

    const targetCount = Math.min(12, Math.max(1, Number(clips) || 6));
    const job = await this.jobs.create(file.originalname);

    try {
      await this.jobs.patch(job.id, { stage: 'uploading', progress: 5 });
      const md5 = await md5File(file.path);
      const existing = await this.cloud.findExisting(md5, file.size, language);
      const asset = existing ?? (await this.cloud.upload(file.path, file.originalname, md5, language));
      await this.jobs.patch(job.id, { progress: 12 }, { asset, reused: !!existing });
      await this.cut.enqueue({ jobId: job.id, asset, targetCount });
    } catch (e: any) {
      await this.jobs.patch(job.id, { stage: 'failed', error: e.message });
      throw new BadRequestException(e.message);
    } finally {
      unlink(file.path).catch(() => undefined);
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
