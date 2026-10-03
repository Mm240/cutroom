import { Module } from '@nestjs/common';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { VideosController } from './videos.controller';
import { CutProcessor } from './cut.processor';
import { JobsStore } from '../store/jobs.store';

@Module({
  imports: [CloudinaryModule],
  controllers: [VideosController],
  providers: [CutProcessor, JobsStore],
})
export class VideosModule {}
