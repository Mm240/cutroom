import { Module } from '@nestjs/common';
import { CloudinaryService } from './cloudinary.service';
import { GroqService } from './groq.service';

@Module({ providers: [CloudinaryService, GroqService], exports: [CloudinaryService, GroqService] })
export class CloudinaryModule {}
